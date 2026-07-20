# Citation Validation (Phase 5 "Mr. Bond")

## Scope

`apps/web/features/bond/services/citation-validation.service.ts` — the guard between an LLM's raw
response text and what actually gets persisted onto a `Message` row and streamed to the client as a
`citations` SSE event. This is not a replacement for Phase 4's Citation Engine
(`apps/web/features/retrieval/services/citation.service.ts`, documented in docs/retrieval.md) — it
sits on top of it, reusing `resolveCitationService` unmodified. Nothing in this file talks to an AI
provider; it's pure string parsing plus a set-membership check plus one re-fetch per surviving ref.

The file's own doc comment states the whole design in four sentences:

```ts
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
```

## Where the `[ref]` markers come from

`buildPrompt` (`apps/web/features/ai/services/prompt-builder.service.ts`) tells the model exactly
what to cite with, in the system preamble:

```ts
const SYSTEM_PREAMBLE =
  'You are answering questions using only the provided context. Cite sources using their [ref] markers. If the context does not contain the answer, say so.';
```

and hands it the citation set to draw from, built once per turn from *every* retrieved result
(`context.rawResults`), not just the lines that survived the prompt's token budget:

```ts
export function buildPrompt(
  context: AssembledContext,
  results: HybridSearchResult[],
  organization: OrganizationMetadata,
  tokenLimit: number,
  options: BuildPromptOptions = {},
): BuiltPrompt {
  const citations = buildCitations(results);
  ...
  return { messages, citations, estimatedTokens: usedTokens, truncated };
}
```

Each context line embeds its own `ref` inline (`[${chunk.key}] (from "...")`, `[${entity.key}]: ...`),
so a well-behaved model echoes that same `kind:id` token back in its answer. `built.citations` — the
full list `buildPrompt` returns alongside the generated `messages` — is exactly the "retrieved-context
citations list" layer 1 checks membership against.

## Layer 1: membership

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
(`ENTITY:cly...`, `CHUNK:cly...`, `EMAIL:cly...`, `MEETING:cly...` — the four `RetrievalSourceKind`
values from docs/retrieval.md, always upper-case). `matchAll` into a `Set` both extracts every
bracketed ref the model wrote and deduplicates repeats — a model citing `[ENTITY:abc]` three times in
one answer only gets validated (and only re-resolved, in layer 2) once.

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

`availableByRef` is built from `availableCitations` — the caller-supplied list, which in the only
real caller (`rag-pipeline.service.ts`) is `built.citations`, i.e. `buildCitations(context.rawResults)`
from this exact turn. A ref not in that map is skipped (`continue`) before layer 2 ever runs — no
database call is even attempted for a ref the model simply made up or copied from an unrelated
context.

## Why a DB-existence check alone isn't enough

It would be simpler to validate a citation with a single step: take whatever ref the model wrote, try
to resolve it via `resolveCitationService`, and keep it if that succeeds. That's exactly what layer 2
does in isolation — but run *by itself*, it only proves the referenced row still exists somewhere in
the organization. It proves nothing about whether that row had anything to do with this answer.

Concretely: `resolveCitationService(organizationId, ref)` looks up `ref` by `kind:id` against
`prisma.chunk`/`prisma.entity`/`prisma.email`/`prisma.meeting`, scoped only by `organizationId` — the
same four branches documented in docs/retrieval.md. Any entity, chunk, email, or meeting in the org
that the model happens to guess a valid-looking id for (or free-associates from something it saw
earlier in the conversation, or in a different retrieval turn) would resolve successfully and read
back a fully legitimate `Citation` — real title, real document, real confidence `1`. Nothing about
that lookup can distinguish "this is the source I actually used" from "this is a real row in this org
that I'm citing without ever having retrieved it this turn." That's precisely the gap the membership
check in layer 1 closes: `built.citations` is the *complete, closed set* of what hybrid search
actually surfaced for this specific question, so a ref has to have been shown to the model at all
before `resolveCitationService` is even called on it. A citation that only passes DB-existence is,
in the RAG sense, still a hallucination — the model didn't cite a source, it cited an id.

## Layer 2: re-resolution — why it's still needed given layer 1

Membership alone isn't sufficient either, in the other direction: `built.citations` is a snapshot
taken at retrieval time, at the start of the turn. By the time the model finishes streaming its
answer, a `Citation`'s underlying `Chunk`/`Entity`/`Email`/`Meeting` row could theoretically have been
deleted by someone else in the org. Re-running `resolveCitationService` re-fetches current detail
rather than trusting the retrieval-time snapshot verbatim, so a since-deleted source is caught (its
lookup throws `NotFoundError`, caught by the `try`/`catch`, silently dropped) instead of being shown
as if it still exists. It also normalizes the shape: `resolveCitationService` returns the full
`Citation` (document/page/chunk/entity detail) the Source Viewer needs, sourced fresh rather than
whatever partial shape happened to be on the in-memory `built.citations` entry.

## Both layers must pass, or the ref is silently dropped

There is no third state. A cited ref is either:

- **not in `availableByRef`** → skipped before any DB call, or
- **in `availableByRef` but `resolveCitationService` throws** (deleted, or in practice anything
  `NotFoundError`-shaped) → caught, skipped, or
- **in `availableByRef` and resolves** → pushed onto `validated`.

Only the third case makes it into the array `validateCitations` returns. There is no partial-credit
path, no "unverified" badge, no error surfaced back to the model or the user for the first two — the
ref simply doesn't appear in the final citation list, and the sentence the model wrote around it is
left exactly as generated (the `[ref]` marker stays in the raw text; nothing rewrites `finalContent`
to strip it). The comment in the source is explicit about this being the intended behavior, not a gap:
`// Hallucinated or since-deleted — silently dropped, never persisted or displayed.`

## Where it plugs into the RAG pipeline

`rag-pipeline.service.ts` calls `validateCitations` exactly once per turn, after the full assistant
response has finished streaming — never per-token, never before generation completes:

```ts
if (!finalContent.trim()) {
  throw new ValidationError('The AI provider returned an empty response.');
}

const citations = await validateCitations(organizationId, finalContent, built.citations);

...

const assistantMessage = await createMessage({
  conversationId,
  organizationId,
  role: 'ASSISTANT',
  content: finalContent,
  citations: citations as unknown as Prisma.InputJsonValue,
  tokenUsage,
  model: config.model,
  metadata: { toolCallsUsed, durationMs: Date.now() - start },
});

await touchConversation(conversationId, organizationId);

yield { type: 'citations', citations };
```

Two consequences of that ordering:

- **`Message.citations` only ever contains validated citations.** The schema comment on `Message`
  says so directly: `citations are re-resolved via resolveCitationService before being persisted
  here, so a hallucinated ref never lands in this column (see docs/citations.md)`. Nothing raw from
  the model's own text is ever written into that `Json?` column.
- **The client only ever receives validated citations.** The SSE `citations` event
  (`apps/web/features/bond/lib/stream-events.ts`'s `BondStreamEvent`) is yielded with the *validated*
  array, after generation is done — `CitationBadge` and the rest of the UI have no way to render a
  ref that didn't survive both layers, because they never receive it.

## Reuse, not reimplementation

`citation-validation.service.ts` imports `resolveCitationService` and `Citation` directly from
Phase 4's `citation.service.ts` — there is no second, parallel implementation of the
`CHUNK`/`ENTITY`/`EMAIL`/`MEETING` resolution branches documented in docs/retrieval.md. If Phase 4's
resolver ever gains a fifth citation kind, this file needs no change to pick it up; its only
responsibility is the two-layer gate around whatever `resolveCitationService` already knows how to
resolve.

## What's deliberately not built

- **No "N citations removed" notice.** A dropped citation is invisible end to end — no warning is
  logged to the user, no placeholder badge, no count. The assistant's prose can end up referencing a
  `[ref]` marker that never resolved to a visible citation chip, and that's treated as acceptable:
  silence over surfacing an internal validation failure to the end user.
- **No self-correction loop.** Validation happens once, after the model has already finished
  generating; there's no re-prompt ("that citation was invalid, try again") and no retry of
  generation when citations fail validation.
- **No confidence threshold or quality gate beyond pass/fail.** A citation that resolves is kept
  regardless of its original retrieval `confidence` — `resolveCitationService` always returns
  `confidence: 1` for anything it successfully resolves (see docs/retrieval.md), so there's no
  concept of "resolved, but low-confidence, so still drop it."
- **No caching of resolved citations within or across turns.** Every surviving ref re-hits
  `resolveCitationService` (and therefore the database) independently, even if the exact same ref was
  already resolved earlier in the same conversation.
