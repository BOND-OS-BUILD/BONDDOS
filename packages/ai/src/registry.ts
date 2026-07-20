import { AnthropicProvider } from './providers/anthropic';
import { GeminiAiProvider } from './providers/gemini';
import { OllamaAiProvider } from './providers/ollama';
import { OpenAiProvider } from './providers/openai';
import type { AIProvider, AIProviderId } from './types';

export interface AIRegistryConfig {
  provider: AIProviderId;
  openai?: { apiKey: string; baseUrl?: string };
  anthropic?: { apiKey: string; baseUrl?: string };
  gemini?: { apiKey: string; baseUrl?: string };
  ollama?: { baseUrl?: string };
}

/**
 * A pure factory — no env-var reading (same reasoning as
 * `@bond-os/embeddings`'s `createEmbeddingProvider`: keeps this package
 * dependency-free, the app layer composes it with `getEnv()`). Unlike
 * embeddings, there's no sensible "local" fallback for text generation — a
 * fake generator returning placeholder text would be actively misleading,
 * not a useful default — so an unconfigured provider throws immediately
 * rather than silently degrading. Callers that need graceful "not
 * configured" UI (health checks, the AI Settings page) check configuration
 * before calling this, not after catching the throw.
 */
export function createAIProvider(config: AIRegistryConfig): AIProvider {
  switch (config.provider) {
    case 'OPENAI':
      if (!config.openai?.apiKey) throw new Error('AI_PROVIDER=OPENAI requires OPENAI_API_KEY.');
      return new OpenAiProvider(config.openai);
    case 'ANTHROPIC':
      if (!config.anthropic?.apiKey) throw new Error('AI_PROVIDER=ANTHROPIC requires ANTHROPIC_API_KEY.');
      return new AnthropicProvider(config.anthropic);
    case 'GEMINI':
      if (!config.gemini?.apiKey) throw new Error('AI_PROVIDER=GEMINI requires GEMINI_API_KEY.');
      return new GeminiAiProvider(config.gemini);
    case 'OLLAMA':
      return new OllamaAiProvider(config.ollama);
    default:
      throw new Error(`Unknown AI provider: ${String(config.provider)}`);
  }
}
