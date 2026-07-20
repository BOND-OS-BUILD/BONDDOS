import { requireRole } from '@bond-os/auth';
import {
  getOrganizationAiSettings,
  upsertOrganizationAiSettings,
  type OrganizationAiSettingsData,
} from '@bond-os/database';
import { ROLES, ValidationError, type UpdateOrganizationAiSettingsInput } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';
import type { AIProviderId } from '@bond-os/ai';

import { isAIProviderIdConfigured } from '@/features/ai/services/ai-provider.service';

/**
 * Phase 4's `/ai` page explicitly deferred a settings UI to "a future
 * phase" — this is that phase. `OrganizationAiSettings` is one row per org,
 * every field nullable: a null field falls back to the existing env-var
 * default, never to a hardcoded product default, so the org's own env
 * config remains the single source of truth until an admin overrides it.
 */

export async function getOrganizationAiSettingsService(organizationId: string): Promise<OrganizationAiSettingsData | null> {
  await requireRole(organizationId, ROLES.MEMBER);
  return getOrganizationAiSettings(organizationId);
}

export async function updateOrganizationAiSettingsService(
  organizationId: string,
  userId: string,
  input: UpdateOrganizationAiSettingsInput,
): Promise<OrganizationAiSettingsData> {
  await requireRole(organizationId, ROLES.ADMIN);

  if (input.provider && !isAIProviderIdConfigured(input.provider)) {
    throw new ValidationError(`AI provider "${input.provider}" is not configured (missing API key).`);
  }

  return upsertOrganizationAiSettings(organizationId, { ...input, updatedById: userId });
}

export interface EffectiveAiConfig {
  providerId: AIProviderId;
  model: string;
  temperature: number;
  topP: number | undefined;
  maxTokens: number;
  streamingEnabled: boolean;
  contextWindow: number;
  retrievalDepth: number;
}

/**
 * Merges the org's `OrganizationAiSettings` (if any) over the env-var
 * defaults — every field independently falls back, so an org can override
 * just the model while still inheriting the env's temperature. `modelOverride`
 * (the per-message Model Selector, spec §9) wins over both when present.
 */
export async function resolveEffectiveAiConfigService(
  organizationId: string,
  modelOverride?: string,
): Promise<EffectiveAiConfig> {
  await requireRole(organizationId, ROLES.MEMBER);
  const env = getEnv();
  const settings = await getOrganizationAiSettings(organizationId);

  const providerId = ((settings?.provider as AIProviderId | null) ?? env.AI_PROVIDER) || undefined;
  if (!providerId) throw new ValidationError('No AI provider configured for this organization.');
  if (!isAIProviderIdConfigured(providerId)) {
    throw new ValidationError(`AI provider "${providerId}" is not configured (missing API key).`);
  }

  const model = modelOverride || settings?.model || env.AI_MODEL;
  if (!model) throw new ValidationError('No AI model configured for this organization.');

  return {
    providerId,
    model,
    temperature: settings?.temperature ?? env.AI_TEMPERATURE,
    topP: settings?.topP ?? undefined,
    maxTokens: settings?.maxTokens ?? env.AI_MAX_TOKENS,
    streamingEnabled: settings?.streamingEnabled ?? true,
    contextWindow: settings?.contextWindow ?? env.CONTEXT_TOKEN_BUDGET,
    retrievalDepth: settings?.retrievalDepth ?? 30,
  };
}
