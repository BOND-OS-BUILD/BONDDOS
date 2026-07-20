import { requireRole } from '@bond-os/auth';
import { listMessageTokenUsage } from '@bond-os/database';
import { ROLES, type BondCostQuery } from '@bond-os/shared';
import type { TokenUsage } from '@bond-os/ai';

/**
 * Cost Tracking (spec §14) — sums `Message.tokenUsage` (already recorded by
 * the RAG pipeline on every assistant turn) using a small, hardcoded
 * per-model $/1K-token table. Documented as an approximation, not
 * represented as exact: rates drift over time and this table isn't kept in
 * sync with providers' live pricing pages automatically.
 */

interface CostRates {
  promptPer1K: number;
  completionPer1K: number;
}

const DEFAULT_RATES: CostRates = { promptPer1K: 0.002, completionPer1K: 0.006 };

/** Approximate — last verified against public pricing pages at the time this phase shipped. Unknown models fall back to `DEFAULT_RATES`. */
const COST_TABLE: Record<string, CostRates> = {
  'gpt-4o': { promptPer1K: 0.0025, completionPer1K: 0.01 },
  'gpt-4o-mini': { promptPer1K: 0.00015, completionPer1K: 0.0006 },
  'gpt-4-turbo': { promptPer1K: 0.01, completionPer1K: 0.03 },
  'claude-3-5-sonnet-20241022': { promptPer1K: 0.003, completionPer1K: 0.015 },
  'claude-3-5-haiku-20241022': { promptPer1K: 0.0008, completionPer1K: 0.004 },
  'claude-3-opus-20240229': { promptPer1K: 0.015, completionPer1K: 0.075 },
  'gemini-1.5-pro': { promptPer1K: 0.00125, completionPer1K: 0.005 },
  'gemini-1.5-flash': { promptPer1K: 0.000075, completionPer1K: 0.0003 },
};

export function estimateCostUsd(model: string, usage: Pick<TokenUsage, 'promptTokens' | 'completionTokens'>): number {
  const rates = COST_TABLE[model] ?? DEFAULT_RATES;
  return (usage.promptTokens / 1000) * rates.promptPer1K + (usage.completionTokens / 1000) * rates.completionPer1K;
}

export interface CostSummary {
  totalCostUsd: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalMessages: number;
  byModel: Array<{ model: string; costUsd: number; promptTokens: number; completionTokens: number; messages: number }>;
  /** `'bond'` for pre-Phase-7 rows and any turn with no `metadata.agentKey` (Bond's own `/api/bond/chat` path never sets one). */
  byAgent: Array<{ agentKey: string; costUsd: number; promptTokens: number; completionTokens: number; messages: number }>;
  approximate: true;
}

function parseTokenUsage(value: unknown): Pick<TokenUsage, 'promptTokens' | 'completionTokens'> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const promptTokens = typeof record.promptTokens === 'number' ? record.promptTokens : 0;
  const completionTokens = typeof record.completionTokens === 'number' ? record.completionTokens : 0;
  return { promptTokens, completionTokens };
}

function parseAgentKey(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return 'bond';
  const agentKey = (metadata as Record<string, unknown>).agentKey;
  return typeof agentKey === 'string' && agentKey.length > 0 ? agentKey : 'bond';
}

export async function getCostSummaryService(organizationId: string, query: BondCostQuery): Promise<CostSummary> {
  await requireRole(organizationId, ROLES.MEMBER);

  const since = new Date(Date.now() - query.sinceDays * 24 * 60 * 60 * 1000);
  const rows = await listMessageTokenUsage(organizationId, {
    conversationId: query.conversationId,
    userId: query.userId,
    since,
  });

  const byModel = new Map<string, { costUsd: number; promptTokens: number; completionTokens: number; messages: number }>();
  const byAgent = new Map<string, { costUsd: number; promptTokens: number; completionTokens: number; messages: number }>();
  let totalCostUsd = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;

  for (const row of rows) {
    const usage = parseTokenUsage(row.tokenUsage);
    if (!usage) continue;

    const model = row.model ?? 'unknown';
    const costUsd = estimateCostUsd(model, usage);

    totalCostUsd += costUsd;
    totalPromptTokens += usage.promptTokens;
    totalCompletionTokens += usage.completionTokens;

    const existing = byModel.get(model) ?? { costUsd: 0, promptTokens: 0, completionTokens: 0, messages: 0 };
    existing.costUsd += costUsd;
    existing.promptTokens += usage.promptTokens;
    existing.completionTokens += usage.completionTokens;
    existing.messages += 1;
    byModel.set(model, existing);

    const agentKey = parseAgentKey(row.metadata);
    const existingAgent = byAgent.get(agentKey) ?? { costUsd: 0, promptTokens: 0, completionTokens: 0, messages: 0 };
    existingAgent.costUsd += costUsd;
    existingAgent.promptTokens += usage.promptTokens;
    existingAgent.completionTokens += usage.completionTokens;
    existingAgent.messages += 1;
    byAgent.set(agentKey, existingAgent);
  }

  return {
    totalCostUsd,
    totalPromptTokens,
    totalCompletionTokens,
    totalMessages: rows.length,
    byModel: Array.from(byModel.entries()).map(([model, stats]) => ({ model, ...stats })),
    byAgent: Array.from(byAgent.entries()).map(([agentKey, stats]) => ({ agentKey, ...stats })),
    approximate: true,
  };
}
