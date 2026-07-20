import { BaseEmbeddingProvider } from '../base-provider';
import { EmbeddingProviderError } from '../types';

export interface VoyageEmbeddingConfig {
  apiKey: string;
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

const DEFAULT_MODEL = 'voyage-3';
const DEFAULT_DIMENSIONS = 1024;

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
}

/** Real REST calls to Voyage AI's `/v1/embeddings` — native batch support via an array `input`. */
export class VoyageEmbeddingProvider extends BaseEmbeddingProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensionCount: number;
  private readonly baseUrl: string;

  constructor(config: VoyageEmbeddingConfig) {
    super();
    this.apiKey = config.apiKey;
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensionCount = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.baseUrl = config.baseUrl ?? 'https://api.voyageai.com/v1';
  }

  providerName(): string {
    return 'voyage';
  }

  dimensions(): number {
    return this.dimensionCount;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    if (!embedding) throw new EmbeddingProviderError('voyage', 'No embedding returned.');
    return embedding;
  }

  override async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.embed(texts);
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: texts, model: this.model }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new EmbeddingProviderError('voyage', `HTTP ${response.status}: ${detail}`);
    }

    const json = (await response.json()) as VoyageEmbeddingResponse;
    return json.data.sort((a, b) => a.index - b.index).map((item) => item.embedding);
  }
}
