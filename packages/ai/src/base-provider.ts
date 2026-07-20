import { countTokens } from './tokenizer';
import type { AIProvider, GenerateInput, GenerateResult, HealthStatus, ModelInfo } from './types';

/**
 * `countTokens` is shared across every provider via the package's
 * provider-agnostic tokenizer (cl100k_base) — a real tokenizer, not a
 * heuristic, since the Context Builder's token budget depends on it being
 * accurate. Exact tokenization differs slightly per model family (Claude/
 * Gemini don't use cl100k_base internally); this is documented as a close,
 * consistent approximation in docs/ai-service.md, not represented as exact
 * for every provider.
 */
export abstract class BaseAIProvider implements AIProvider {
  abstract generate(input: GenerateInput): Promise<GenerateResult>;
  abstract stream(input: GenerateInput): AsyncIterable<string>;
  abstract listModels(): Promise<ModelInfo[]>;
  abstract health(): Promise<HealthStatus>;

  countTokens(text: string): number {
    return countTokens(text);
  }
}
