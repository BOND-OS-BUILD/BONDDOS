export type EmbeddingProviderId = 'OPENAI' | 'GEMINI' | 'VOYAGE' | 'OLLAMA' | 'LOCAL';

/**
 * The provider contract every embedding backend implements. `generateEmbedding`/
 * `dimensions`/`providerName` are the spec's own interface, verbatim;
 * `generateEmbeddings` is an additive batch method (Performance §16) — a
 * provider with a native batch API overrides it, otherwise
 * `BaseEmbeddingProvider` falls back to sequential calls.
 */
export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  dimensions(): number;
  providerName(): string;
}

export class EmbeddingProviderError extends Error {
  constructor(provider: string, message: string, cause?: unknown) {
    super(`${provider} embedding provider error: ${message}`);
    this.name = 'EmbeddingProviderError';
    this.cause = cause;
  }
}
