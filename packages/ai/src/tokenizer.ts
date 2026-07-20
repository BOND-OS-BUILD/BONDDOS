import { encode } from 'gpt-tokenizer';

/**
 * Provider-agnostic token counting (cl100k_base), usable without
 * instantiating any `AIProvider` — the Context Builder needs accurate token
 * budgets regardless of whether an `AI_PROVIDER` is even configured
 * (retrieval/embeddings never require AI generation to be set up).
 */
export function countTokens(text: string): number {
  return encode(text).length;
}
