import { requireRole } from '@bond-os/auth';
import {
  getAiTokenTotal,
  getDerivedUsageCounts,
  getUsageEventTotals,
  recordUsageEvent,
} from '@bond-os/database';
import { ROLES, type AnalyticsWindowQuery } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';

/**
 * Phase 10 — usage metering (billing-ready; no payment provider). Most
 * metrics are DERIVED from existing operational tables (no duplicated
 * storage). AI tokens come from assistant-message token usage. API calls and
 * storage bytes are sourced from explicit `UsageEvent` rows (recordable via
 * `recordUsage`) — they read 0 until their optional hot-path hooks are
 * enabled, which is deliberate: a durable per-request/-upload meter is opt-in
 * so it never adds a write to every request.
 */

export interface UsageSummary {
  organizationId: string;
  sinceDays: number;
  metrics: {
    aiTokens: number;
    embeddings: number;
    storageBytes: number;
    apiCalls: number;
    toolExecutions: number;
    workflowExecutions: number;
    notifications: number;
  };
  storageLimitMb: number;
}

async function computeUsage(organizationId: string, sinceDays: number): Promise<UsageSummary> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const [aiTokens, derived, eventTotals] = await Promise.all([
    getAiTokenTotal(organizationId, since),
    getDerivedUsageCounts(organizationId, since),
    getUsageEventTotals(organizationId, since),
  ]);
  return {
    organizationId,
    sinceDays,
    metrics: {
      aiTokens: aiTokens + (eventTotals.AI_TOKENS ?? 0),
      embeddings: derived.embeddings + (eventTotals.EMBEDDINGS ?? 0),
      storageBytes: eventTotals.STORAGE_BYTES ?? 0,
      apiCalls: eventTotals.API_CALLS ?? 0,
      toolExecutions: derived.toolExecutions + (eventTotals.TOOL_EXECUTIONS ?? 0),
      workflowExecutions: derived.workflowExecutions + (eventTotals.WORKFLOW_EXECUTIONS ?? 0),
      notifications: derived.notifications + (eventTotals.NOTIFICATIONS ?? 0),
    },
    storageLimitMb: getEnv().STORAGE_LIMIT_MB,
  };
}

/** Org-scoped usage summary (org ADMIN or OWNER). */
export async function getOrgUsageSummary(
  organizationId: string,
  query: AnalyticsWindowQuery,
): Promise<UsageSummary> {
  await requireRole(organizationId, ROLES.ADMIN);
  return computeUsage(organizationId, query.sinceDays);
}

/** Internal usage summary without a role check — for the platform Admin Console. */
export async function computeOrgUsage(organizationId: string, sinceDays: number): Promise<UsageSummary> {
  return computeUsage(organizationId, sinceDays);
}

/**
 * Record an explicit usage event (e.g. storage bytes on upload, API calls via
 * a batched flusher). Available for billing granularity; not on any hot path
 * by default.
 */
export async function recordUsage(
  organizationId: string,
  metric: Parameters<typeof recordUsageEvent>[0]['metric'],
  quantity: number,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await recordUsageEvent({ organizationId, metric, quantity, metadata });
}
