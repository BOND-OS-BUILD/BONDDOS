import { GeminiEmbeddingProvider } from './providers/gemini';
import { LocalHashEmbeddingProvider } from './providers/local-hash';
import { OllamaEmbeddingProvider } from './providers/ollama';
import { OpenAiEmbeddingProvider } from './providers/openai';
import { VoyageEmbeddingProvider } from './providers/voyage';
import type { EmbeddingProvider, EmbeddingProviderId } from './types';

export interface EmbeddingRegistryConfig {
  provider: EmbeddingProviderId;
  dimensions?: number;
  openai?: { apiKey: string; model?: string };
  gemini?: { apiKey: string; model?: string };
  voyage?: { apiKey: string; model?: string };
  ollama?: { model?: string; baseUrl?: string };
}

/**
 * A pure factory — no env-var reading here (that stays out of this package,
 * same as `packages/connectors` has no env awareness either; the app layer
 * reads env vars and passes an explicit config, keeping this package
 * dependency-free and testable in isolation). Throws a clear, immediate
 * error if a real provider is selected but not configured — never silently
 * falls back to a different provider than the one requested.
 */
export function createEmbeddingProvider(config: EmbeddingRegistryConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'OPENAI':
      if (!config.openai?.apiKey) throw new Error('EMBEDDING_PROVIDER=OPENAI requires OPENAI_API_KEY.');
      return new OpenAiEmbeddingProvider({
        apiKey: config.openai.apiKey,
        model: config.openai.model,
        dimensions: config.dimensions,
      });
    case 'GEMINI':
      if (!config.gemini?.apiKey) throw new Error('EMBEDDING_PROVIDER=GEMINI requires GEMINI_API_KEY.');
      return new GeminiEmbeddingProvider({
        apiKey: config.gemini.apiKey,
        model: config.gemini.model,
        dimensions: config.dimensions,
      });
    case 'VOYAGE':
      if (!config.voyage?.apiKey) throw new Error('EMBEDDING_PROVIDER=VOYAGE requires VOYAGE_API_KEY.');
      return new VoyageEmbeddingProvider({
        apiKey: config.voyage.apiKey,
        model: config.voyage.model,
        dimensions: config.dimensions,
      });
    case 'OLLAMA':
      return new OllamaEmbeddingProvider({
        model: config.ollama?.model,
        baseUrl: config.ollama?.baseUrl,
        dimensions: config.dimensions,
      });
    case 'LOCAL':
    default:
      return new LocalHashEmbeddingProvider({ dimensions: config.dimensions });
  }
}
