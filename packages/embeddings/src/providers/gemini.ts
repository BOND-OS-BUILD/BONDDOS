import { BaseEmbeddingProvider } from '../base-provider';
import { EmbeddingProviderError } from '../types';

export interface GeminiEmbeddingConfig {
  apiKey: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

const DEFAULT_MODEL = 'text-embedding-004';
const DEFAULT_DIMENSIONS = 768;

interface GeminiEmbedContentResponse {
  embedding: { values: number[] };
}

interface GeminiBatchEmbedContentsResponse {
  embeddings: Array<{ values: number[] }>;
}

/** Real REST calls to Google's Generative Language API `embedContent`/`batchEmbedContents`. */
export class GeminiEmbeddingProvider extends BaseEmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensionCount: number;
  private readonly baseUrl: string;

  constructor(config: GeminiEmbeddingConfig) {
    super();
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensionCount = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.baseUrl = config.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  providerName(): string {
    return 'gemini';
  }

  dimensions(): number {
    return this.dimensionCount;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/models/${this.model}:embedContent?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
        outputDimensionality: this.dimensionCount,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new EmbeddingProviderError('gemini', `HTTP ${response.status}: ${detail}`);
    }

    const json = (await response.json()) as GeminiEmbedContentResponse;
    return json.embedding.values;
  }

  override async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const response = await fetch(`${this.baseUrl}/models/${this.model}:batchEmbedContents?key=${this.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${this.model}`,
          content: { parts: [{ text }] },
          outputDimensionality: this.dimensionCount,
        })),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new EmbeddingProviderError('gemini', `HTTP ${response.status}: ${detail}`);
    }

    const json = (await response.json()) as GeminiBatchEmbedContentsResponse;
    return json.embeddings.map((item) => item.values);
  }
}
