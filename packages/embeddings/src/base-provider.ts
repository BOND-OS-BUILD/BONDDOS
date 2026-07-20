import type { EmbeddingProvider } from './types';

/**
 * Shared scaffolding: `generateEmbeddings` defaults to N sequential
 * `generateEmbedding` calls for providers with no native batch endpoint.
 * Providers that do have one (OpenAI, Voyage, Gemini, Ollama's `/api/embed`)
 * override it with a single real batched request.
 */
export abstract class BaseEmbeddingProvider implements EmbeddingProvider {
  abstract generateEmbedding(text: string): Promise<number[]>;
  abstract dimensions(): number;
  abstract providerName(): string;

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.generateEmbedding(text));
    }
    return results;
  }
}
