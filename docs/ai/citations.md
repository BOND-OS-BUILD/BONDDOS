# Citations

## Scope

Two files, two layers, one job: make sure nothing a Mr. Bond (or specialist-agent) answer claims to
cite is trusted just because the model wrote it down.

- **Citation Engine** — `apps/web/features/retrieval/services/citation.service.ts`. Pure formatting
  from a retrieved result into a `Citation`, plus the one function that resolves a bare `ref` string
  back to full detail by direct database lookup.
- **Citation Validation** — `apps/web/features/bond/services/citation-validation.service.ts`. Sits
  on top of the Citation Engine, reusing it unmodified; the guard between an LLM's raw response text
  and what actually gets persisted onto a `Message` row and streamed to the client.

Nothing in either file talks to an AI provider — this is string parsing, a set-membership check, and
database re-fetches, run **after** generation has already finished for the turn.

## The `Citation` shape

```ts
export interface Citation {
  /** Opaque, stable — the same HybridSearchResult.key shape (`${kind}:${id}`), what an AI response actually cites. */
  ref: string;
  documentId: string | null;
  documentTitle: string | null;
  page: number | null;
  chunkId: string | null;
  entityId: string | null;
  entityTitle: string | null;
  /** From buildCitation: the result's ranked relevance score, clamped to [0,1]. From resolveCitationService: always 1 — a direct lookup by ref has no "relevance," only "found." */
  confidence: number;
}
```

## Layer 0: `buildCitation` — pure formatting, no DB access

```ts
export function buildCitation(result: HybridSearchResult): Citation {
  const id = result.key.slice(result.kind.length + 1);
  return {
    ref: result.key,
    documentId: result.knowledgeDocumentId,
    documentTitle: result.kind === 'ENTITY' ? result.title : null,
    page: null,
    chunkId: result.kind === 'CHUNK' ? id : null,
    entityId: result.kind === 'ENTITY' ? id : null,
    entityTitle: result.kind === 'ENTITY' ? result.title : null,
    confidence: clamp01(result.score),
  };
}

export function buildCitations(results: HybridSearchResult[]): Citation[] {
  return results.map(buildCitation);
}
```

Synchronous, no async, no database call — it's reshaping data [Hybrid Search](./retrieval.md) already
produced. `confidence` here is the result's ranked hybrid score, clamped to `[0,1]`.
[Prompt Builder](./prompt-builder.md) calls `buildCitations(context.rawResults)` once per turn — see
[Citation scope vs. prompt scope](#citation-scope-vs-prompt-scope) for why it uses `rawResults`
rather than only what made it into the assembled prompt.

## Layer 1: `resolveCitationService` — resolve a bare `ref` to full detail

The one function in the Citation Engine that hits the database. Backs `GET /api/retrieval/citations`
and is reused, unmodified, by Citation Validation's re-resolution step below. Splits `ref` on its
first `:` and branches on the resulting `kind`:

```ts
if (kind === 'CHUNK') {
  const chunk = await prisma.chunk.findFirst({
    where: { id, knowledgeDocument: { organizationId } },
    select: { id: true, pageNumber: true, knowledgeDocument: { select: { id: true, entity: { select: { id: true, title: true } } } } },
  });
  if (!chunk) throw new NotFoundError('Citation not found.');
  return { ref, documentId: chunk.knowledgeDocument.id, documentTitle: chunk.knowledgeDocument.entity.title, page: chunk.pageNumber, chunkId: chunk.id, entityId: chunk.knowledgeDocument.entity.id, entityTitle: chunk.knowledgeDocument.entity.title, confidence: 1 };
}
```

Four branches — `CHUNK`, `ENTITY`, `EMAIL`, `MEETING` — each a `prisma.*.findFirst` scoped by
`organizationId` (and, for `CHUNK`, transitively via `knowledgeDocument: { organizationId }`),
throwing `NotFoundError` if the row doesn't exist in this org. **Every branch returns
`confidence: 1`** — deliberate, not an oversight: `buildCitation`'s confidence is a *relevance*
score (how well this result matched a query, relative to its pool); `resolveCitationService` is a
direct lookup by id, which either finds the row or throws — there's no notion of "relevance" for a
lookup, only "found," so `1` is the only meaningful value.

## Layer 2: Citation Validation — the model's claims are never trusted as-is

`citation-validation.service.ts`'s own doc comment states the design in full:

```ts
/**
 * Citation validation — the model is instructed to cite using `[ref]`
 * markers matching buildPrompt's citations list. Two layers, both must pass
 * before a citation is ever persisted or shown:
 *
 * 1. Membership: the ref must be one buildCitations(rawResults) actually
 *    produced for THIS answer — a ref the model invented, or a ref to a
 *    real row it was never shown, is dropped here even if that row exists
 *    in the org (citing something never retrieved is still hallucination
 *    in a RAG sense, not just "row doesn't exist").
 * 2. Re-resolution: resolveCitationService re-fetches full detail for
 *    what's left — defense in depth against a row being deleted between
 *    retrieval and the citation being shown, and the source of the
 *    confidence-independent detail the Source Viewer needs.
 */
```

### Extracting what the model cited

```ts
const REF_MARKER = /\[([A-Z]+:[A-Za-z0-9_-]+)\]/g;

export function extractCitedRefs(content: string): string[] {
  const refs = new Set<string>();
  for (const match of content.matchAll(REF_MARKER)) {
    if (match[1]) refs.add(match[1]);
  }
  return Array.from(refs);
}
```

`REF_MARKER` matches the same `${kind}:${id}` shape as `Citation.ref`/`HybridSearchResult.key`
(`ENTITY:cly…`, `CHUNK:cly…`, `EMAIL:cly…`, `MEETING:cly…` — always upper-case). `matchAll` into a
`Set` both extracts every bracketed ref the model wrote and deduplicates repeats: a model citing
`[ENTITY:abc]` three times in one answer only gets validated (and only re-resolved) once.

### Both layers

```ts
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
```

1. **Membership** — `availableByRef` is built from `availableCitations`, the caller-supplied list
   which, in the only real caller
   ([`runBondChatPipeline`](./rag.md) / `runThinkLoop`), is `built.citations` —
   `buildCitations(context.rawResults)` for *this exact turn*. A ref the model wrote that isn't in
   this map is `continue`d past — no database call is even attempted. Citing something never
   retrieved is treated as hallucination even if the underlying row genuinely exists somewhere in the
   org.
2. **Re-resolution** — every surviving ref calls `resolveCitationService(organizationId, ref)`
   inside a `try`/`catch`; a throw (the row was deleted between retrieval and now, or the ref never
   resolved at all) is silently swallowed — the code comment is explicit: `// Hallucinated or
   since-deleted — silently dropped, never persisted or displayed.`

### Why a DB-existence check alone isn't enough

It would be simpler to validate with one step: take whatever ref the model wrote, try
`resolveCitationService`, keep it if that succeeds. That's exactly what layer 2 does in isolation —
but by itself it only proves the referenced row still exists *somewhere in the organization*, not
that it had anything to do with this answer. `resolveCitationService(organizationId, ref)` looks up
`ref` by `kind:id` scoped only by `organizationId` — any entity, chunk, email, or meeting in the org
that the model happens to guess (or free-associates from something it saw earlier in the
conversation, or in a different retrieval turn) resolves successfully and reads back a fully
legitimate `Citation` with a real title, a real document, and `confidence: 1`. Nothing about that
lookup can distinguish "this is the source I actually used this turn" from "this is a real row in
this org I'm citing without ever having retrieved it." The membership check closes exactly that gap:
`built.citations` is the complete, closed set of what hybrid search actually surfaced for this
specific question, so a ref has to have been shown to the model at all before
`resolveCitationService` is even called on it.

### Why re-resolution is still needed, given membership already passed

`built.citations` is a snapshot taken at retrieval time, at the start of the turn. By the time the
model finishes streaming its answer, a `Citation`'s underlying `Chunk`/`Entity`/`Email`/`Meeting` row
could theoretically have been deleted by someone else in the org. Re-running
`resolveCitationService` re-fetches current detail rather than trusting the retrieval-time snapshot
verbatim, so a since-deleted source is caught (`NotFoundError`, caught, silently dropped) instead of
being shown as if it still exists. It also normalizes shape: `resolveCitationService` returns the
full detail the Source Viewer needs, sourced fresh rather than whatever partial shape happened to be
on the in-memory `built.citations` entry.

### Three outcomes, no partial credit

A cited ref is either:

- **not in `availableByRef`** → skipped before any DB call, or
- **in `availableByRef` but `resolveCitationService` throws** → caught, skipped, or
- **in `availableByRef` and resolves** → pushed onto `validated`.

Only the third case survives. There is no "unverified" badge, no partial-credit state, no count or
warning surfaced back to the model or the end user for the first two — the ref simply doesn't appear
in the final citation list, and the sentence the model wrote around it is left exactly as generated
(the `[ref]` text itself is never stripped or rewritten out of `finalContent`).

## Where it plugs into the pipeline

`validateCitations` is called exactly once per turn, **after** the full assistant response has
finished streaming — never per-token, never before generation completes:

```ts
if (!finalContent.trim()) {
  throw new ValidationError('The AI provider returned an empty response.');
}

const citations = await validateCitations(organizationId, finalContent, built.citations);
```

Two consequences of that ordering:

- **`Message.citations` only ever contains validated citations.** The schema comment on `Message`
  says so directly: `citations are re-resolved via resolveCitationService before being persisted
  here, so a hallucinated ref never lands in this column (see docs/citations.md)`. Nothing raw from
  the model's own text is ever written into that `Json?` column.
- **The client only ever receives validated citations.** The SSE `citations` event
  (`apps/web/features/bond/lib/stream-events.ts`'s `BondStreamEvent`) carries the *validated* array,
  yielded after generation is done. `CitationBadge` and `SourcePanel` (below) have no way to render a
  ref that didn't survive both layers, because they never receive it.

`runThinkLoop` (the shared multi-agent engine, see [Agents Overview](../agents/overview.md)) calls
the exact same `validateCitations` at the same point in its own loop — there is no second,
parallel citation-validation implementation for agent turns.

## Citation scope vs. prompt scope

`built.citations` is built from `context.rawResults` — the **full, unfiltered** output of the turn's
`retrieve()` call (up to 30 items) — not from whatever survived
[Context Builder's](./context-builder.md) or [Prompt Builder's](./prompt-builder.md) own token-budget
truncation. This means a citation can legitimately appear in `built.citations` for an item whose
actual text never made it into the model's shown context window. `validateCitations`'s membership
check only cares whether the model's `[ref]` appears in that citation list — it does not check
whether the underlying content line was actually printed into the prompt. In practice this is
low-risk: a model can only write a `[ref]` marker it learned the exact string of, and the only place
it would learn a ref string is from seeing it inline as a `[ref]` marker in the context text it was
shown. But it is a structural nuance worth being precise about — "every validated citation was
literally shown to the model" is not a guarantee this code makes explicitly, it's an emergent
property of how ref strings only ever originate from prompt text.

## Rendering: `CitationBadge` and the Source Panel

Once `citations` arrives on the client via the `{ type: 'citations' }` SSE event and is attached to
the persisted `Message`, `apps/web/features/bond/components/message-bubble.tsx` renders them as a
row of chips **below** the assistant's markdown answer — not inline in place of the `[ref]` markers
in the text itself (a `[ENTITY:abc]`-shaped bracket in the raw markdown renders as literal text,
since markdown only treats `[text](url)` specially, not a bare `[text]`):

```tsx
{citations.length > 0 ? (
  <div className="flex flex-wrap gap-1.5">
    {citations.map((citation) => (
      <CitationBadge key={citation.ref} citation={citation} onClick={() => onCitationClick?.(citation)} />
    ))}
  </div>
) : null}
```

`CitationBadge` (`apps/web/features/bond/components/citation-badge.tsx`) renders a compact
document/entity label (`documentTitle` + page, or `entityTitle`, falling back to the raw `ref`) plus
a rounded confidence percentage, color-coded (`≥75%` success, `≥50%` warning, else destructive — note
this scale is meaningful for `buildCitation`'s relevance-derived confidence, but every citation that
survives validation has already been re-resolved via `resolveCitationService`, which itself always
sets `confidence: 1` on the *re-resolved* object returned by layer 2 — so the confidence actually
rendered is the re-resolution's `1`, not the original retrieval-time relevance score). Clicking a
badge opens `SourcePanel` (`apps/web/features/bond/components/source-panel.tsx`), a slide-over that
fetches either `GET /api/retrieval/document?id=...` (when `citation.documentId` is set — chunk-level
preview, highlighting the specific cited chunk) or `GET /api/retrieval/entity?id=...` (when
`citation.entityId` is set — related entities + timeline) and renders whichever detail comes back.
Both routes are the same [Retrieval](./retrieval.md#api-surface) endpoints reused unchanged.

## Reuse, not reimplementation

`citation-validation.service.ts` imports `resolveCitationService` and `Citation` directly from
`citation.service.ts` — there is no second, parallel implementation of the
`CHUNK`/`ENTITY`/`EMAIL`/`MEETING` resolution branches. If the Citation Engine ever gains a fifth
citation kind, Citation Validation needs no change to pick it up; its only responsibility is the
two-layer gate around whatever `resolveCitationService` already knows how to resolve.

## What's deliberately not built

- **No "N citations removed" notice.** A dropped citation is invisible end to end — no warning
  logged to the user, no placeholder badge, no count anywhere in the response.
- **No self-correction loop.** Validation happens once, after the model has already finished
  generating; there's no re-prompt ("that citation was invalid, try again") and no retry of
  generation when citations fail validation.
- **No confidence threshold or quality gate beyond pass/fail.** A citation that resolves is kept
  regardless of its original retrieval `confidence` — `resolveCitationService` always returns
  `confidence: 1` for anything it successfully resolves, so there's no concept of "resolved, but
  low-confidence, so still drop it."
- **No caching of resolved citations within or across turns.** Every surviving ref re-hits
  `resolveCitationService` (and therefore the database) independently, even if the exact same ref
  was already resolved earlier in the same conversation.

## See also

- [Retrieval](./retrieval.md) — where `HybridSearchResult` (the input to `buildCitation`) comes from.
- [Prompt Builder](./prompt-builder.md) — builds `built.citations` and tells the model how to cite.
- [RAG Pipeline](./rag.md) — where `validateCitations` is called, once per turn, after streaming
  completes.
- [Memory](./memory.md) — `getConversationMemoryFacts` aggregates over `Message.citations` from
  prior turns.
- [Database Schema](../database/schema.md) — the `Message.citations` column this whole layer feeds.
