import { createAIProvider, type AIProvider, type AIProviderId } from '@bond-os/ai';
import { getEnv } from '@bond-os/shared/server';

/** The composition root for `@bond-os/ai` — same reasoning as `embedding-provider.service.ts`: keeps the package dependency-free, this file is where env vars and the provider factory meet. */

export function isAIProviderIdConfigured(providerId: AIProviderId): boolean {
  const env = getEnv();
  switch (providerId) {
    case 'OPENAI':
      return Boolean(env.OPENAI_API_KEY);
    case 'ANTHROPIC':
      return Boolean(env.ANTHROPIC_API_KEY);
    case 'GEMINI':
      return Boolean(env.GEMINI_API_KEY);
    case 'OLLAMA':
      return true;
    default:
      return false;
  }
}

export function isAIProviderConfigured(): boolean {
  const env = getEnv();
  if (!env.AI_PROVIDER) return false;
  return isAIProviderIdConfigured(env.AI_PROVIDER);
}

const providerCache = new Map<AIProviderId, AIProvider>();

/**
 * Resolves (and caches) a provider by explicit id — Phase 5's per-org
 * `OrganizationAiSettings.provider` override needs a provider that may
 * differ from `env.AI_PROVIDER`, without disturbing `getAIProvider()`'s own
 * cache/behavior for existing Phase 4 callers (`ai.service.ts`'s
 * `listModels`/`health`). Throws if that provider's credentials aren't
 * configured — callers must check `isAIProviderIdConfigured()` first.
 */
export function getAIProviderById(providerId: AIProviderId): AIProvider {
  const cached = providerCache.get(providerId);
  if (cached) return cached;

  if (!isAIProviderIdConfigured(providerId)) {
    throw new Error(`AI provider "${providerId}" is not configured.`);
  }

  const env = getEnv();
  const created = createAIProvider({
    provider: providerId,
    openai: env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : undefined,
    anthropic: env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : undefined,
    gemini: env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY } : undefined,
    ollama: { baseUrl: env.OLLAMA_BASE_URL },
  });
  providerCache.set(providerId, created);
  return created;
}

/** Throws if unconfigured — callers must check `isAIProviderConfigured()` first for graceful "not configured" UI (see `ai.service.ts`). */
export function getAIProvider(): AIProvider {
  const env = getEnv();
  if (!env.AI_PROVIDER) throw new Error('No AI_PROVIDER configured.');
  return getAIProviderById(env.AI_PROVIDER);
}

export function getActiveModelLabel(): string | null {
  const env = getEnv();
  return env.AI_MODEL || null;
}
