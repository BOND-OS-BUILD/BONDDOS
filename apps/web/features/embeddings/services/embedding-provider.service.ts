import { createEmbeddingProvider, type EmbeddingProvider } from '@bond-os/embeddings';
import { getEnv } from '@bond-os/shared/server';

/**
 * The composition root for `@bond-os/embeddings`: reads `getEnv()` and hands
 * an explicit config object to the package's pure factory. Keeps
 * `@bond-os/embeddings` itself dependency-free (mirrors `packages/connectors`
 * having no env awareness) while still giving the "configurable through
 * environment variables" behavior the spec asks for — this file is the one
 * place env vars and the provider factory meet.
 */

let cachedProvider: EmbeddingProvider | undefined;
let cachedProviderId: string | undefined;

export function getEmbeddingProvider(): EmbeddingProvider {
  const env = getEnv();
  if (cachedProvider && cachedProviderId === env.EMBEDDING_PROVIDER) {
    return cachedProvider;
  }

  cachedProvider = createEmbeddingProvider({
    provider: env.EMBEDDING_PROVIDER,
    dimensions: env.EMBEDDING_DIMENSIONS,
    openai: env.OPENAI_API_KEY
      ? { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_EMBEDDING_MODEL || env.EMBEDDING_MODEL || undefined }
      : undefined,
    gemini: env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY, model: env.EMBEDDING_MODEL || undefined } : undefined,
    voyage: env.VOYAGE_API_KEY ? { apiKey: env.VOYAGE_API_KEY, model: env.EMBEDDING_MODEL || undefined } : undefined,
    ollama: { baseUrl: env.OLLAMA_BASE_URL, model: env.EMBEDDING_MODEL || undefined },
  });
  cachedProviderId = env.EMBEDDING_PROVIDER;
  return cachedProvider;
}

const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  OPENAI: 'text-embedding-3-small',
  GEMINI: 'text-embedding-004',
  VOYAGE: 'voyage-3',
  OLLAMA: 'nomic-embed-text',
  LOCAL: 'local-hash-v1',
};

/** The exact model string to record on an `Embedding` row — `EmbeddingProvider` itself has no `model()` accessor, so this stays alongside the construction logic that already knows it. */
export function getEmbeddingModelLabel(): string {
  const env = getEnv();
  if (env.EMBEDDING_PROVIDER === 'OPENAI') return env.OPENAI_EMBEDDING_MODEL || env.EMBEDDING_MODEL || DEFAULT_MODEL_BY_PROVIDER.OPENAI!;
  if (env.EMBEDDING_PROVIDER === 'LOCAL') return DEFAULT_MODEL_BY_PROVIDER.LOCAL!;
  return env.EMBEDDING_MODEL || DEFAULT_MODEL_BY_PROVIDER[env.EMBEDDING_PROVIDER] || env.EMBEDDING_PROVIDER;
}

export function isEmbeddingProviderConfigured(): boolean {
  const env = getEnv();
  switch (env.EMBEDDING_PROVIDER) {
    case 'OPENAI':
      return Boolean(env.OPENAI_API_KEY);
    case 'GEMINI':
      return Boolean(env.GEMINI_API_KEY);
    case 'VOYAGE':
      return Boolean(env.VOYAGE_API_KEY);
    case 'OLLAMA':
    case 'LOCAL':
    default:
      return true;
  }
}
