# Retrieval (Phase 4)

## Scope

Hybrid Search, the Retrieval Engine, and the Citation Engine — the three pieces of spec §5/§7 that
turn Phase 2's full-text search and Phase 4's new embeddings into one ranked, cited result list.
`apps/web/features/retrieval/services/{hybrid-search,retrieval,citation}.service.ts`. See
docs/embeddings.md (how the vectors this feature searches are generated), docs/vector-search.md
(the pgvector storage/query layer `vectorSimilaritySearch` itself lives in), and
docs/context-builder.md (what's built on top of retrieval for assembling AI context) for the
adjacent pieces.

## Hybrid search: 4 signals, one ranked list

`hybrid-search.service.ts` combines text relevance, semantic similarity, relationship proximity, and
recency into a single `score` per candidate:

```ts
const RECENCY_HALF_LIFE_DAYS = 30;
const WEIGHTS = { text: 0.35, semantic: 0.35, relationship: 0.2, recency: 0.1 };
```

- **Text relevance** — Phase 2's `searchEntities` (docs/search.md), reused as-is, not reimplemented.
  Its `ts_rank` score becomes `textScore`.
- **Semantic similarity** — the new `vectorSimilaritySearch`, pgvector cosine similarity
  (`1 - (vector <=> queryVector)`) over `Embedding.vector`, ordered nearest-first.
- **Relationship proximity** — reuses Phase 3's already-batched `listRelationshipsForEntities` to
  count edges *within the current result set only*: a candidate connected to another candidate
  already in this result set ranks higher. It is not a graph-wide connectivity score.

  ```ts
  const idSet = new Set(entityIds);
  const connectionCounts = new Map<string, number>();
  for (const edge of edges) {
    if (!idSet.has(edge.sourceEntity.id) || !idSet.has(edge.targetEntity.id)) continue;
    connectionCounts.set(edge.sourceEntity.id, (connectionCounts.get(edge.sourceEntity.id) ?? 0) + 1);
    connectionCounts.set(edge.targetEntity.id, (connectionCounts.get(edge.targetEntity.id) ?? 0) + 1);
  }
  ```

- **Recency** — exponential decay on `createdAt`, half-life configurable via the
  `RECENCY_HALF_LIFE_DAYS` constant (currently 30 days):

  ```ts
  function recencyScore(createdAt: Date): number {
    const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
    return Math.pow(0.5, Math.max(ageDays, 0) / RECENCY_HALF_LIFE_DAYS);
  }
  ```

Each signal is normalized to `[0,1]` against **this query's own candidate pool**, not a fixed global
scale — a min-max-style normalizer divides by the pool's own max value:

```ts
/** Min-max style normalization against the pool's own max (not a fixed scale) — every signal lands in [0,1] relative to this query's own candidates. */
function normalizer(values: number[]): (value: number) => number {
  const max = Math.max(0, ...values);
  if (max <= 0) return () => 0;
  return (value: number) => Math.max(0, Math.min(1, value / max));
}
```

`textScore` and `semanticScore` are normalized this way across all candidates; `relationshipScore`
is normalized across just the entity candidates' connection counts. `recencyScore` is already `[0,1]`
by construction (a decay curve), so it isn't run through `normalizer`. The final `score` is the
weighted sum of all four normalized signals.

## Organization scope is a hard filter, not a signal

The 4 weighted signals above are the entire ranking model — organization scope is deliberately not
one of them. It's enforced as a hard filter inside both branches that produce candidates:
`searchEntities(organizationId, ...)` and `vectorSimilaritySearch(organizationId, ...)` each take
`organizationId` as a required first argument and filter on it in their own `WHERE` clause. A result
can score anywhere on text/semantic/relationship/recency, but it can never appear at all for the
wrong org — there's no weight that could let a cross-org match "win" by scoring high enough.

## Dedup: `${kind}:${id}` as the identity key

```ts
export type RetrievalSourceKind = 'ENTITY' | 'CHUNK' | 'EMAIL' | 'MEETING';
```

Every candidate — whether it came from the text branch or the vector branch — is keyed by
`` `${kind}:${id}` `` in a single `Map`, so a source found by both branches merges into one candidate
with a combined score instead of appearing twice. The one real identity overlap in this codebase:
`EmbeddingSourceType` includes a fourth value, `NOTE`, that `RetrievalSourceKind` doesn't have. A
NOTE embedding and a plain `Entity` search hit for the *same* NOTE entity need to land on the same
key, so `sourceTypeToKind` maps `NOTE` straight onto `ENTITY`:

```ts
/** NOTE embeddings key off the source Entity's id — the same identity space a plain Entity search hit uses — so a NOTE found by both branches merges into one candidate instead of appearing twice. */
export function sourceTypeToKind(sourceType: EmbeddingSourceType): RetrievalSourceKind {
  return sourceType === 'NOTE' ? 'ENTITY' : sourceType;
}
```

`CHUNK`/`EMAIL`/`MEETING` pass through unchanged — those embedding source types have no equivalent
text-search branch to collide with, so they only ever merge with another vector hit of the same
source.

Merge order in `hybridSearch`: text hits populate the map first (keyed `ENTITY:${id}`), then vector
hits either update an existing entry's `semanticScore` (`Math.max` of any repeat) or insert a new
one keyed by `` `${sourceTypeToKind(hit.sourceType)}:${hit.sourceId}` ``.

## The Retrieval Engine — "No LLM calls. Only retrieve."

`retrieval.service.ts` wraps `hybridSearch` with the three things spec §5 asks for beyond ranking
itself: query preprocessing, permission checks, and audit logging.

Preprocessing is deliberately simple — trim and collapse whitespace, nothing NLP-shaped:

```ts
function preprocessQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}
```

Every call is permission-checked and audit-logged, with timing and result count captured in
`metadata`:

```ts
export async function retrieve(
  organizationId: string,
  rawQuery: string,
  options: RetrieveOptions = {},
): Promise<HybridSearchResult[]> {
  await requireRole(organizationId, ROLES.MEMBER);

  const query = preprocessQuery(rawQuery);
  if (!query) return [];

  const start = Date.now();
  const results = await hybridSearch(organizationId, query, options);
  const durationMs = Date.now() - start;

  await logAiRequest({
    organizationId,
    action: 'retrieval.search',
    metadata: { query: rawQuery, resultCount: results.length, durationMs },
  });

  return results;
}
```

The file's own import list is the enforcement mechanism for "No LLM calls. Only retrieve," not a
comment promising it: `retrieval.service.ts` imports `hybridSearch` (one layer down) plus
`@bond-os/auth`, `@bond-os/database`, `@bond-os/shared`, and the embedding provider getter for
`findSimilar`'s re-embedding — nothing from `@bond-os/ai`'s generation surface. `@bond-os/embeddings`
(the actual provider implementation) is only ever touched inside `hybrid-search.service.ts`, one
layer further down still. A future change that tried to make this file call an LLM would have to add
a new import to do it — there's nothing here to repurpose.

`findSimilar` (`/api/retrieval/similar`, "more like this") re-embeds the source's own stored
`content` rather than reading the stored vector back out of Postgres, because `Embedding.vector` is
`Unsupported` in Prisma and there's no typed way to select it back out:

```ts
const source = await prisma.embedding.findFirst({
  where: { organizationId, sourceType, sourceId },
  select: { content: true },
});
if (!source) throw new NotFoundError('No embedding found for this source.');

const provider = getEmbeddingProvider();
const vector = await provider.generateEmbedding(source.content);
```

## The Citation Engine

`citation.service.ts` turns any `HybridSearchResult` into a `Citation`:

```ts
export interface Citation {
  ref: string;
  documentId: string | null;
  documentTitle: string | null;
  page: number | null;
  chunkId: string | null;
  entityId: string | null;
  entityTitle: string | null;
  confidence: number;
}
```

`buildCitation` is pure formatting over data retrieval already produced — no DB access, no async:

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
```

`confidence` here is the result's ranked hybrid score, clamped to `[0,1]`.

`resolveCitationService` is the one function in this feature that hits the database — it resolves a
bare `ref` string (`kind:id`, the same shape a future AI response would cite) back to full detail,
for `/api/retrieval/citations`. It branches on the 4 `RetrievalSourceKind` values:

```ts
if (kind === 'CHUNK') {
  const chunk = await prisma.chunk.findFirst({
    where: { id, knowledgeDocument: { organizationId } },
    select: {
      id: true,
      pageNumber: true,
      knowledgeDocument: { select: { id: true, entity: { select: { id: true, title: true } } } },
    },
  });
  if (!chunk) throw new NotFoundError('Citation not found.');
  return {
    ref, documentId: chunk.knowledgeDocument.id, documentTitle: chunk.knowledgeDocument.entity.title,
    page: chunk.pageNumber, chunkId: chunk.id, entityId: chunk.knowledgeDocument.entity.id,
    entityTitle: chunk.knowledgeDocument.entity.title, confidence: 1,
  };
}

if (kind === 'ENTITY') {
  const entity = await prisma.entity.findFirst({ where: { id, organizationId }, select: { id: true, title: true } });
  if (!entity) throw new NotFoundError('Citation not found.');
  return { ref, documentId: null, documentTitle: null, page: null, chunkId: null, entityId: entity.id, entityTitle: entity.title, confidence: 1 };
}

if (kind === 'EMAIL') {
  const email = await prisma.email.findFirst({ where: { id, organizationId }, select: { id: true, subject: true } });
  if (!email) throw new NotFoundError('Citation not found.');
  return { ref, documentId: null, documentTitle: null, page: null, chunkId: null, entityId: null, entityTitle: email.subject, confidence: 1 };
}

if (kind === 'MEETING') {
  const meeting = await prisma.meeting.findFirst({ where: { id, organizationId }, select: { id: true, title: true } });
  if (!meeting) throw new NotFoundError('Citation not found.');
  return { ref, documentId: null, documentTitle: null, page: null, chunkId: null, entityId: null, entityTitle: meeting.title, confidence: 1 };
}
```

Every branch returns `confidence: 1`. That's deliberate, not an oversight: `buildCitation`'s
confidence is a *relevance* score (how well this result matched a query, relative to its pool);
`resolveCitationService` is a direct lookup by id, which either finds the row or throws
`NotFoundError` — there's no "relevance" for a lookup, only "found," so `1` is the only meaningful
value.

## API surface

`apps/web/app/api/retrieval/`:

- `search` (`GET`) — `retrieve()`, the ranked hybrid-search list.
- `similar` (`GET`) — `findSimilar()`, "more like this" for a given `sourceType`/`sourceId`.
- `citations` (`GET`) — `resolveCitationService()`, batched via `Promise.allSettled` over a `refs`
  array so one bad ref doesn't fail the whole request.
- `context` (`GET`) — `buildContext()`, see docs/context-builder.md.
- `document` (`GET`) — `getDocumentRetrievalInfoService()`, document-level retrieval metadata.
- `entity` (`GET`) — `getEntityMemoryService()`, entity-level retrieval/memory info.

All six follow the same `apiHandler` / `requireActiveOrganizationId` / `parseQueryParams` pattern as
every other route in the codebase.

## What's deliberately not built

No query expansion or synonym handling beyond what Phase 2's `websearch_to_tsquery`-based FTS
already does natively (docs/search.md) — hybrid search adds a second signal, it doesn't add NLP to
the first one. No learned or trained ranking model: `WEIGHTS` is a fixed set of constants tuned by
hand once, not fit against click data or feedback. No personalization — results vary by
`organizationId` (the hard filter) and by the query itself, never by which user within the org is
asking; two members of the same org searching the same query get the same ranked list.
