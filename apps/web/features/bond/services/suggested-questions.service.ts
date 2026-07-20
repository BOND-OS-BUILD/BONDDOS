import type { AssembledContext } from '@/features/retrieval/services/context-builder.service';

/**
 * Suggested Questions (spec §8) — rule-based off the same `AssembledContext`
 * the answer was built from, not LLM-generated (same "no hallucinated
 * summaries" principle Phase 4 already applies to memory). The UI clears
 * these the moment the user sends their next message — nothing here tracks
 * dismissal state server-side.
 */

const MAX_SUGGESTIONS = 4;

export function generateSuggestedQuestions(context: AssembledContext): string[] {
  const suggestions: string[] = [];

  if (context.meetings.length > 0) suggestions.push('What happened after this meeting?');
  if (context.projects.length > 0) suggestions.push('Show related projects.');
  if (context.connectedEntities.some((entity) => entity.entityType === 'PERSON')) {
    suggestions.push('Who worked on this?');
  }
  if (context.customers.length > 0) suggestions.push('What is the status of this customer?');
  if (context.timelineEvents.length > 0) suggestions.push('What happened most recently?');
  if (context.documents.length > 0) suggestions.push('Summarize this document.');

  return suggestions.slice(0, MAX_SUGGESTIONS);
}
