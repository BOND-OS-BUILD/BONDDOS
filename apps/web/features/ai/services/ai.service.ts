import { requireRole } from '@bond-os/auth';
import { countTokens, type HealthStatus, type ModelInfo } from '@bond-os/ai';
import { getAiAuditStats, logAiRequest, type AiAuditStats } from '@bond-os/database';
import { ROLES } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';

import { getEmbeddingModelLabel, isEmbeddingProviderConfigured } from '@/features/embeddings/services/embedding-provider.service';

import { getActiveModelLabel, getAIProvider, isAIProviderConfigured } from './ai-provider.service';

/**
 * The org-scoped, audit-logged surface over `@bond-os/ai` — `listModels()`/
 * `health()` are the only generation-provider methods this phase's UI
 * actually calls (the AI Configuration pages); `generate()`/`stream()` are
 * real and implemented but unreachable from any page, per the spec's "no UI
 * yet." `countTokens()` is exposed standalone (§ below) since it needs no
 * configured provider at all — the Context Builder must work even with
 * AI_PROVIDER unset.
 */

export interface AIModelManagementInfo {
  aiProvider: string | null;
  aiProviderConfigured: boolean;
  activeModel: string | null;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingProviderConfigured: boolean;
  temperature: number;
  maxTokens: number;
  contextTokenBudget: number;
}

export async function getModelManagementInfoService(organizationId: string): Promise<AIModelManagementInfo> {
  await requireRole(organizationId, ROLES.MEMBER);
  const env = getEnv();

  return {
    aiProvider: env.AI_PROVIDER ?? null,
    aiProviderConfigured: isAIProviderConfigured(),
    activeModel: getActiveModelLabel(),
    embeddingProvider: env.EMBEDDING_PROVIDER,
    embeddingModel: getEmbeddingModelLabel(),
    embeddingProviderConfigured: isEmbeddingProviderConfigured(),
    temperature: env.AI_TEMPERATURE,
    maxTokens: env.AI_MAX_TOKENS,
    contextTokenBudget: env.CONTEXT_TOKEN_BUDGET,
  };
}

/** Returns an empty list (not an error) when no provider is configured — the Models page renders an empty/"not configured" state, not a crash. */
export async function listAIModelsService(organizationId: string): Promise<ModelInfo[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  if (!isAIProviderConfigured()) return [];

  const env = getEnv();
  const provider = getAIProvider();
  const models = await provider.listModels();
  await logAiRequest({ organizationId, action: 'ai.list_models', provider: env.AI_PROVIDER });
  return models;
}

export interface AIHealthResult extends HealthStatus {
  configured: boolean;
}

export async function getAIHealthService(organizationId: string): Promise<AIHealthResult> {
  await requireRole(organizationId, ROLES.MEMBER);
  if (!isAIProviderConfigured()) {
    return { healthy: false, configured: false, message: 'No AI provider configured.' };
  }

  const provider = getAIProvider();
  const status = await provider.health();
  return { ...status, configured: true };
}

/** No org check, no provider needed — a pure local computation the Context Builder calls freely. */
export function countTokensService(text: string): number {
  return countTokens(text);
}

export async function getAiAuditStatsService(organizationId: string): Promise<AiAuditStats> {
  await requireRole(organizationId, ROLES.MEMBER);
  return getAiAuditStats(organizationId);
}
