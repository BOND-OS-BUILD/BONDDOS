import { BaseEmbeddingProvider } from '../base-provider';
import { EmbeddingProviderError } from '../types';

export interface OllamaEmbeddingConfig {
  model?: string;
  dimensions?: number;
  baseUrl?: string;
}

const DEFAULT_MODEL = 'nomic-embed-text';
const DEFAULT_DIMENSIONS = 768;

interface OllamaEmbedResponse {
  embeddings: number[][];
}

/** Real REST calls to a local Ollama server's `/api/embed` (its newer unified endpoint — supports batch via an array `input`, unlike the older single-text `/api/embeddings`). */
export class OllamaEmbeddingProvider extends BaseEmbeddingProvider {
  private readonly model: string;
  private readonly dimensionCount: number;
  private readonly baseUrl: string;

  constructor(config: OllamaEmbeddingConfig = {}) {
    super();
    this.model = config.model ?? DEFAULT_MODEL;
    this.dimensionCount = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.baseUrl = config.baseUrl ?? 'http://localhost:11434';
  }

  providerName(): string {
    return 'ollama';
  }

  dimensions(): number {
    return this.dimensionCount;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const [embedding] = await this.embed([text]);
    if (!embedding) throw new EmbeddingProviderError('ollama', 'No embedding returned.');
    return embedding;
  }

  override async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    return this.embed(texts);
  }

  private async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: texts }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => response.statusText);
      throw new EmbeddingProviderError('ollama', `HTTP ${response.status}: ${detail}`);
    }

    const json = (await response.json()) as OllamaEmbedResponse;
    return json.embeddings;
  }
}
