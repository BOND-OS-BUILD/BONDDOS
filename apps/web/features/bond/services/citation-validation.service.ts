import { resolveCitationService, type Citation } from '@/features/retrieval/services/citation.service';

/**
 * Citation validation (spec §6/§15) — the model is instructed to cite using
 * `[ref]` markers matching `buildPrompt`'s `citations` list. Two layers,
 * both must pass before a citation is ever persisted or shown:
 *
 * 1. Membership: the ref must be one `buildCitations(rawResults)` actually
 *    produced for THIS answer — a ref the model invented, or a ref to a
 *    real row it was never shown, is dropped here even if that row exists
 *    in the org (citing something never retrieved is still hallucination
 *    in a RAG sense, not just "row doesn't exist").
 * 2. Re-resolution: `resolveCitationService` re-fetches full detail for
 *    what's left — defense in depth against a row being deleted between
 *    retrieval and the citation being shown, and the source of the
 *    confidence-independent detail the Source Viewer needs.
 */

const REF_MARKER = /\[([A-Z]+:[A-Za-z0-9_-]+)\]/g;

export function extractCitedRefs(content: string): string[] {
  const refs = new Set<string>();
  for (const match of content.matchAll(REF_MARKER)) {
    if (match[1]) refs.add(match[1]);
  }
  return Array.from(refs);
}

export async function validateCitations(
  organizationId: string,
  content: string,
  availableCitations: Citation[],
): Promise<Citation[]> {
  const citedRefs = extractCitedRefs(content);
  const availableByRef = new Map(availableCitations.map((citation) => [citation.ref, citation]));

  const validated: Citation[] = [];
  for (const ref of citedRefs) {
    if (!availableByRef.has(ref)) continue;
    try {
      validated.push(await resolveCitationService(organizationId, ref));
    } catch {
      // Hallucinated or since-deleted — silently dropped, never persisted or displayed.
    }
  }
  return validated;
}
