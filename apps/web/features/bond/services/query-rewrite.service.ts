import type { ChatMessage } from '@bond-os/ai';

/**
 * Query Rewrite (RAG pipeline stage 2, spec §3) — deterministic, not a
 * second LLM call: folds the prior user turn into the retrieval query when
 * the current question looks like a pronoun-driven follow-up ("what about
 * him?", "and then?"), so `retrieve()` gets a self-contained query instead
 * of a fragment. "No hallucinated summaries" (Phase 4's own memory
 * principle) applies here too — this is string concatenation, not
 * generation.
 */

const FOLLOW_UP_PRONOUNS = /\b(it|this|that|he|she|him|her|they|them|those|these|there)\b/i;
const MIN_STANDALONE_WORDS = 4;

function looksLikeFollowUp(question: string): boolean {
  if (FOLLOW_UP_PRONOUNS.test(question)) return true;
  return question.split(/\s+/).filter(Boolean).length < MIN_STANDALONE_WORDS;
}

export function rewriteQuery(question: string, recentHistory: ChatMessage[]): string {
  const trimmed = question.trim();
  if (!looksLikeFollowUp(trimmed)) return trimmed;

  const lastUserTurn = [...recentHistory].reverse().find((message) => message.role === 'user');
  if (!lastUserTurn) return trimmed;

  const priorQuestion = lastUserTurn.content.trim();
  if (!priorQuestion || priorQuestion === trimmed) return trimmed;

  return `${priorQuestion} ${trimmed}`;
}
