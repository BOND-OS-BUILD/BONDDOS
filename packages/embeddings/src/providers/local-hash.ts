import { BaseEmbeddingProvider } from '../base-provider';

export interface LocalHashEmbeddingConfig {
  dimensions?: number;
}

const DEFAULT_DIMENSIONS = 1536;

function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const tokens = [...words];
  for (let i = 0; i < words.length - 1; i++) {
    tokens.push(`${words[i]}_${words[i + 1]}`);
  }
  return tokens;
}

/** FNV-1a — fast, deterministic, no external dependency. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Deterministic feature-hashing (the "hashing trick") — real math, no ML
 * model, no network call, no API key. This is the zero-config default
 * (`EMBEDDING_PROVIDER` unset or `local`), matching every other pluggable
 * interface in this codebase (`Cache`, `Queue`, `RateLimiter`) always having
 * a working default. It rewards lexical/word overlap between texts, not
 * semantic meaning — a real, useful local fallback for development and
 * testing, not a stand-in for a real embedding model's quality. See
 * docs/embeddings.md.
 */
export class LocalHashEmbeddingProvider extends BaseEmbeddingProvider {
  private readonly dimensionCount: number;

  constructor(config: LocalHashEmbeddingConfig = {}) {
    super();
    this.dimensionCount = config.dimensions ?? DEFAULT_DIMENSIONS;
  }

  providerName(): string {
    return 'local';
  }

  dimensions(): number {
    return this.dimensionCount;
  }

  generateEmbedding(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensionCount).fill(0);
    const tokens = tokenize(text);

    for (const token of tokens) {
      const hash = fnv1a(token);
      const index = hash % this.dimensionCount;
      const sign = hash & 1 ? 1 : -1;
      vector[index] = (vector[index] ?? 0) + sign;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (magnitude === 0) return Promise.resolve(vector);
    return Promise.resolve(vector.map((value) => value / magnitude));
  }
}
