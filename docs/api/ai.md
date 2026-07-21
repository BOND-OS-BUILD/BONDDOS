# AI & Retrieval API

API reference for `/api/ai/**` (provider configuration, model listing, cost tracking, health),
`/api/embeddings/**` (the embedding pipeline), and `/api/retrieval/**` (the Retrieval Engine,
Context Builder, and Citation Engine — Phase 4's "No LLM calls. Only retrieve." surface, deliberately
separate from anything that calls a generation provider). None of the routes in this file ever call
an LLM for text generation — that only happens inside `POST /api/bond/chat` (see
[Bond & Conversations API](./bond.md)). See [Overview](../embeddings.md) and
[Knowledge Graph](../knowledge-graph.md) for the underlying pipeline design.

**15 route files, 17 endpoints** (`GET`/`PATCH` both live under `/api/ai/settings`, and
`POST`/`DELETE` both live under `/api/embeddings`, so those 2 files contribute 2 endpoints each).

## Conventions

Same envelope, pagination, and error-mapping conventions as
[Tools & Execution API](./tools.md#conventions) apply throughout. Specific to this surface:

- Every route calls `requireActiveOrganizationId()`, then the service layer re-checks
  `requireRole(organizationId, ...)` — `MEMBER` for everything except `PATCH /api/ai/settings` and
  the two destructive embedding routes (`DELETE /api/embeddings`, `POST /api/embeddings/rebuild`),
  which require `ADMIN`.
- Every mutating route calls `assertSameOrigin(request)`.
- **No rate limiting anywhere in this surface** — including `/api/embeddings/rebuild`, which
  synchronously deletes and regenerates every embedding in the organization.
- **No background worker exists in this codebase.** Every embedding operation here — generate,
  retry, rebuild, reindex — runs synchronously inside the HTTP request. `getQueue().enqueue(...)`
  calls are made throughout `embedding-pipeline.service.ts` to demonstrate the queue architecture,
  but nothing currently consumes that queue; the actual work happens before the response is
  returned, not asynchronously.
- **No automated tests exist for this surface** — see [Tools & Execution API](./tools.md#conventions).

---

# AI Configuration

`OrganizationAiSettings` — one row per org, every field nullable; a `null` field falls back to the
env-var default, never to a hardcoded product default. Files: `apps/web/app/api/ai/settings/route.ts`,
`apps/web/app/api/ai/models/route.ts`, `apps/web/app/api/ai/cost/route.ts`,
`apps/web/app/api/ai/health/route.ts`.

## `GET /api/ai/settings` — Get Organization AI Settings

**Method / Path**: `GET /api/ai/settings`
**File**: `apps/web/app/api/ai/settings/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Response — `200`

`data: OrganizationAiSettingsData | null` (`null` if the org has never saved settings — every field
then implicitly falls back to env defaults):

```json
{
  "success": true,
  "data": {
    "provider": "ANTHROPIC", "model": "claude-sonnet-4-5", "temperature": 0.7, "topP": null,
    "maxTokens": 4096, "streamingEnabled": true, "contextWindow": 8000, "retrievalDepth": 30,
    "updatedAt": "2026-07-15T09:00:00.000Z"
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Not a member of the active org. |

---

## `PATCH /api/ai/settings` — Update Organization AI Settings

**Method / Path**: `PATCH /api/ai/settings`
**File**: `apps/web/app/api/ai/settings/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`. **`ADMIN`, not
`MEMBER`** — the one exception among this surface's read/write pairs.

### Body — `updateOrganizationAiSettingsSchema`

```ts
{
  provider?: 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OLLAMA' | null;
  model?: string | null;               // max 200
  temperature?: number | null;         // 0-2
  topP?: number | null;                // 0-1
  maxTokens?: number | null;           // positive, max 32000
  streamingEnabled?: boolean;
  contextWindow?: number | null;       // 100-200000
  retrievalDepth?: number | null;      // 1-100
}
```

### Example request

```json
{ "provider": "ANTHROPIC", "model": "claude-sonnet-4-5", "temperature": 0.5 }
```

### Response — `200`

`data: OrganizationAiSettingsData`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+. |
| 422 | `VALIDATION_ERROR` | Malformed body, or `provider` is set to a value with no configured API key ("AI provider ... is not configured (missing API key)."). |

### Notes

- This is what `resolveEffectiveAiConfigService` (used by `POST /api/bond/chat`) merges over the
  env-var defaults at request time — a per-message `model` override on the chat request still wins
  over whatever is saved here.

---

## `GET /api/ai/models` — List Available Models

**Method / Path**: `GET /api/ai/models`
**File**: `apps/web/app/api/ai/models/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Returns an **empty array, not an error**, when no AI provider is configured — the Models page
renders an empty/"not configured" state rather than crashing.

### Response — `200`

`data: ModelInfo[]`:

```ts
interface ModelInfo { id: string; name: string; }
```

```json
{ "success": true, "data": [ { "id": "claude-sonnet-4-5", "name": "Claude Sonnet 4.5" } ] }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |

### Notes

- Every call logs an `AiAuditLog` row (`action: 'ai.list_models'`) via `logAiRequest` — this is the
  live provider's model catalog (a real API call to the configured provider), not a static list.

---

## `GET /api/ai/cost` — Cost Summary

**Method / Path**: `GET /api/ai/cost`
**File**: `apps/web/app/api/ai/cost/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Sums `Message.tokenUsage` (already recorded by the RAG pipeline on every assistant turn) against a
small, hardcoded per-model $/1K-token table (`COST_TABLE`,
`apps/web/features/bond/services/cost-tracking.service.ts:22`). **Explicitly approximate** — the
table is a snapshot of public pricing at the time this phase shipped, not kept in sync with
providers' live pricing automatically; unknown models fall back to a `DEFAULT_RATES` estimate.

### Query params — `bondCostQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `conversationId` | string | — | optional |
| `userId` | string | — | optional |
| `sinceDays` | number | `30` | positive, max 365 |

### Response — `200`

```ts
interface CostSummary {
  totalCostUsd: number; totalPromptTokens: number; totalCompletionTokens: number; totalMessages: number;
  byModel: Array<{ model: string; costUsd: number; promptTokens: number; completionTokens: number; messages: number }>;
  byAgent: Array<{ agentKey: string; costUsd: number; promptTokens: number; completionTokens: number; messages: number }>;
  approximate: true;
}
```

`byAgent` groups by `'bond'` for every pre-Phase-7 row and any turn with no `metadata.agentKey`
(Bond's own `/api/bond/chat` path never sets one) — every other key is a real registered `agentKey`.

```json
{
  "success": true,
  "data": {
    "totalCostUsd": 0.42, "totalPromptTokens": 18400, "totalCompletionTokens": 3100, "totalMessages": 12,
    "byModel": [ { "model": "claude-sonnet-4-5", "costUsd": 0.42, "promptTokens": 18400, "completionTokens": 3100, "messages": 12 } ],
    "byAgent": [ { "agentKey": "bond", "costUsd": 0.30, "promptTokens": 14000, "completionTokens": 2200, "messages": 9 }, { "agentKey": "project_agent", "costUsd": 0.12, "promptTokens": 4400, "completionTokens": 900, "messages": 3 } ],
    "approximate": true
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 422 | `VALIDATION_ERROR` | Invalid `sinceDays`. |

---

## `GET /api/ai/health` — AI Provider Health

**Method / Path**: `GET /api/ai/health`
**File**: `apps/web/app/api/ai/health/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Response — `200`

```ts
interface AIHealthResult { healthy: boolean; configured: boolean; message?: string; latencyMs?: number; }
```

```json
{ "success": true, "data": { "healthy": true, "configured": true, "latencyMs": 210 } }
```

If unconfigured: `{ "healthy": false, "configured": false, "message": "No AI provider configured." }`
— never throws, always `200`.

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |

---

# Embeddings

`Embedding`/`EmbeddingJob` — the vector-store side of retrieval. `CHUNK` embeddings are only ever
generated automatically by the Knowledge Library upload pipeline (see
[Company Data API](./company-data.md#post-apilibrarydocuments--upload-library-document)); the
routes below are the manual/administrative surface over `NOTE`, `EMAIL`, and `MEETING` sources
(the only three Phase 1 record types with no dedicated content table of their own to embed
directly), plus job introspection and bulk rebuild/reindex.

## `POST /api/embeddings` — Generate Embedding for a Source

**Method / Path**: `POST /api/embeddings`
**File**: `apps/web/app/api/embeddings/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

### Body — `generateEmbeddingSchema`

```ts
{ sourceType: 'NOTE' | 'EMAIL' | 'MEETING'; sourceId: string } // CHUNK excluded — see intro
```

### Example request

```json
{ "sourceType": "MEETING", "sourceId": "meet_3c4d..." }
```

### Response — `201`

```json
{ "success": true, "data": { "sourceType": "MEETING", "sourceId": "meet_3c4d..." } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/CSRF/role failures. |
| 404 | `NOT_FOUND` | No embeddable content found for that source (e.g. a `NOTE` entity with an empty `description`). |
| 422 | `VALIDATION_ERROR` | Malformed body. |

### Notes

- Content resolution per type: `NOTE` embeds `Entity.description`; `EMAIL` embeds `subject` only
  (metadata-only in Phase 1 — no body is stored); `MEETING` embeds `agenda` + `notes` joined.
- Records an `EmbeddingJob` row regardless of outcome (`SUCCEEDED` or `FAILED`), and an
  `AiAuditLog` row (`embedding.generate_source`) on success.

---

## `DELETE /api/embeddings` — Delete Embedding for a Source

**Method / Path**: `DELETE /api/embeddings`
**File**: `apps/web/app/api/embeddings/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

### Query params — `deleteEmbeddingQuerySchema`

```ts
{ sourceType: 'CHUNK' | 'NOTE' | 'EMAIL' | 'MEETING'; sourceId: string }
```

### Response — `200`

```json
{ "success": true, "data": { "sourceType": "MEETING", "sourceId": "meet_3c4d..." } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 | `AUTH_ERROR` | No session / no active organization. |
| 403 | `FORBIDDEN` | Missing/mismatched `Origin`, or caller isn't `ADMIN`+. |
| 404 | `NOT_FOUND` | No embedding exists for that `(sourceType, sourceId)`. |
| 422 | `VALIDATION_ERROR` | Malformed query. |

---

## `GET /api/embeddings/jobs` — List Embedding Jobs

**Method / Path**: `GET /api/embeddings/jobs`
**File**: `apps/web/app/api/embeddings/jobs/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

### Query params — `embeddingJobQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `page`, `pageSize` | — | 1 / 20 | shared pagination |
| `status` | enum | — | `PENDING, RUNNING, SUCCEEDED, FAILED, RETRYING` |

### Response — `200`

`data: PaginatedResult<EmbeddingJobSummary>`:

```ts
interface EmbeddingJobSummary {
  id: string; jobType: string; sourceType: string; sourceId: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'RETRYING';
  provider: string | null; errorMessage: string | null; retryCount: number;
  startedAt: string | null; completedAt: string | null; createdAt: string;
}
```

### Errors

Standard auth/role/validation errors.

---

## `POST /api/embeddings/jobs/retry` — Retry Failed Jobs

**Method / Path**: `POST /api/embeddings/jobs/retry`
**File**: `apps/web/app/api/embeddings/jobs/retry/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

Finds every `FAILED` job in the org and re-attempts it synchronously — "no real worker, triggered
manually," the same pattern connector sync jobs use (see [System API](./system.md)).

### Response — `200`

```ts
interface RetryEmbeddingJobsResult { retried: number; succeeded: number; failed: number; }
```

```json
{ "success": true, "data": { "retried": 3, "succeeded": 2, "failed": 1 } }
```

### Errors

Standard auth/CSRF/role errors — a per-job failure during retry does not fail the request; it's
counted in the response's `failed` field.

---

## `POST /api/embeddings/rebuild` — Rebuild All Vectors

**Method / Path**: `POST /api/embeddings/rebuild`
**File**: `apps/web/app/api/embeddings/rebuild/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.ADMIN)`.

**Destructive and expensive** — deletes every embedding in the organization, then regenerates one
for every `KnowledgeDocument` chunk, `NOTE`, `EMAIL`, and `MEETING`, all synchronously in this one
request. Meant for "I changed embedding providers/dimensions," not routine maintenance.

### Response — `200`

```ts
interface RebuildVectorsResult {
  deleted: number; chunksQueued: number; notesQueued: number; emailsQueued: number; meetingsQueued: number;
}
```

```json
{ "success": true, "data": { "deleted": 240, "chunksQueued": 180, "notesQueued": 20, "emailsQueued": 30, "meetingsQueued": 10 } }
```

### Errors

Standard auth/CSRF/role errors. Individual re-embed failures during the rebuild are logged and
skipped, not surfaced as a request-level error.

### Notes

- No request timeout guard exists in the route itself — for an organization with a large embedding
  count, this call can run for a long time before returning; there is no progress reporting.

---

## `POST /api/embeddings/reindex/[id]` — Reindex One Document

**Method / Path**: `POST /api/embeddings/reindex/{id}`
**File**: `apps/web/app/api/embeddings/reindex/[id]/route.ts`
**Auth**: `assertSameOrigin` → `requireRole(organizationId, ROLES.MEMBER)`.

Re-embeds every existing chunk of one `KnowledgeDocument` — for switching embedding models, not for
re-parsing (that remains the upload pipeline's job, unchanged).

### Path params

| Param | Meaning |
|---|---|
| `id` | `KnowledgeDocument.id` |

### Response — `200`

```json
{ "success": true, "data": { "chunksEmbedded": 6 } }
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/CSRF/role failures. |
| 404 | `NOT_FOUND` | No `KnowledgeDocument` with this `id` in this organization. |

---

# Retrieval

The Retrieval Engine (query preprocessing + hybrid text/semantic search + relationship/recency
scoring), Context Builder (token-budgeted assembly of retrieved material), and Citation Engine
(resolving a bare citation `ref` back to full detail). Every route here calls only `requireRole`,
never a generation provider — see the file intro.

## `GET /api/retrieval/search` — Hybrid Search

**Method / Path**: `GET /api/retrieval/search`
**File**: `apps/web/app/api/retrieval/search/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Combines Phase 2 full-text search and Phase 4 vector similarity into one ranked list — 4 signals
(text relevance 0.35, semantic similarity 0.35, relationship proximity 0.2, recency 0.1), each
min-max normalized against the candidate pool for this query. This is the primitive
`POST /api/bond/chat`'s Context Builder and `GET /api/graph/search` both build on — distinct from
the simple `contains`-filter fan-out `GET /api/search` does (see [Search API](./search.md)).

### Query params — `retrievalSearchQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `q` | string | — | required, min 1 char |
| `limit` | number | `20` | 1-50 |

### Response — `200`

`data: HybridSearchResult[]`:

```ts
interface HybridSearchResult {
  key: string;        // `${kind}:${id}` — stable identity for dedup/citations
  kind: 'ENTITY' | 'CHUNK' | 'EMAIL' | 'MEETING';
  id: string; title: string; snippet: string; entityType: string | null;
  knowledgeDocumentId: string | null; createdAt: string;
  textScore: number; semanticScore: number; relationshipScore: number; recencyScore: number;
  score: number; // weighted composite, sorted descending
}
```

```json
{
  "success": true,
  "data": [
    { "key": "CHUNK:chunk_1", "kind": "CHUNK", "id": "chunk_1", "title": "Q3 Sales Overview...", "snippet": "Q3 Sales Overview: revenue up 12%...", "entityType": null, "knowledgeDocumentId": "kdoc_5f2a...", "createdAt": "2026-07-20T09:00:05.000Z", "textScore": 0.8, "semanticScore": 0.91, "relationshipScore": 0, "recencyScore": 0.95, "score": 0.688 }
  ]
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 422 | `VALIDATION_ERROR` | Empty `q`, or `limit` out of range. |

### Notes

- Every call logs an `AiAuditLog` row (`retrieval.search`) with the query, result count, and duration.

---

## `GET /api/retrieval/context` — Build Context Bundle

**Method / Path**: `GET /api/retrieval/context`
**File**: `apps/web/app/api/retrieval/context/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Assembles a token-budgeted bundle for a question: greedy, rank-ordered inclusion from
`retrieve()`'s results, stopping the moment the next item would exceed the budget (deterministic —
same inputs always produce the same cutoff). Connected entities/timeline events are only fetched
for the top 5 highest-ranked `ENTITY` items, not every included item (lazy expansion). This is the
**exact same primitive** `POST /api/bond/chat` calls before every generation — calling this route
directly previews what a chat turn would retrieve, without spending an LLM call.

### Query params — `retrievalContextQuerySchema`

| Field | Type | Notes |
|---|---|---|
| `q` | string | required |
| `tokenBudget` | number | optional, 100-100000; defaults to `CONTEXT_TOKEN_BUDGET` env var |

### Response — `200`

```ts
interface AssembledContext {
  question: string;
  documents: Array<{ id: string; title: string }>;
  chunks: Array<{ key: string; kind: string; title: string; content: string; score: number; tokens: number }>;
  entities: Array<{ key: string; kind: string; title: string; content: string; score: number; tokens: number }>;
  connectedEntities: Array<{ id: string; title: string; entityType: string; depth: number }>;
  timelineEvents: Array<{ id: string; description: string; eventType: string; entityTitle: string }>;
  projects: Array<{ id: string; title: string }>;
  customers: Array<{ id: string; title: string }>;
  meetings: Array<{ id: string; title: string }>;
  totalTokens: number; tokenBudget: number; truncated: boolean;
  rawResults: unknown[]; // the underlying HybridSearchResult[] this was built from
}
```

### Errors

Standard auth/role/validation errors.

---

## `GET /api/retrieval/citations` — Resolve Citations

**Method / Path**: `GET /api/retrieval/citations`
**File**: `apps/web/app/api/retrieval/citations/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

Resolves one or more bare citation `ref`s (`${kind}:${id}`, the exact shape a Bond response cites)
back to full document/page/chunk/entity detail. Each `ref` is resolved independently via
`Promise.allSettled` — a `ref` that doesn't resolve is silently dropped from the response, not
surfaced as a partial error.

### Query params — `retrievalCitationsQuerySchema`

| Field | Type | Notes |
|---|---|---|
| `refs` | string | required, comma-separated, e.g. `CHUNK:chunk_1,ENTITY:ent_9c1a` |

### Response — `200`

```ts
interface Citation {
  ref: string; documentId: string | null; documentTitle: string | null; page: number | null;
  chunkId: string | null; entityId: string | null; entityTitle: string | null; confidence: number; // always 1 for a direct lookup
}
```

```json
{
  "success": true,
  "data": {
    "citations": [
      { "ref": "CHUNK:chunk_1", "documentId": "kdoc_5f2a...", "documentTitle": "Q3 Sales Deck", "page": 1, "chunkId": "chunk_1", "entityId": null, "entityTitle": null, "confidence": 1 }
    ]
  }
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 422 | `VALIDATION_ERROR` | Empty `refs`. |

### Notes

- Supported `kind` prefixes: `CHUNK`, `ENTITY`, `EMAIL`, `MEETING`. Any other prefix, or a `ref`
  with no `:` separator, resolves to nothing for that item (dropped, not a 404 for the whole request).

---

## `GET /api/retrieval/document` — Document Retrieval Status

**Method / Path**: `GET /api/retrieval/document`
**File**: `apps/web/app/api/retrieval/document/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

A `KnowledgeDocument`'s retrieval/embedding status: which chunks exist and which are actually
embedded yet — useful right after upload, before embedding generation catches up.

### Query params — `retrievalDocumentQuerySchema`

```ts
{ id: string } // KnowledgeDocument.id
```

### Response — `200`

```ts
interface DocumentRetrievalInfo {
  knowledgeDocumentId: string; title: string; chunkCount: number; embeddedChunkCount: number;
  chunks: Array<{ id: string; position: number; embedded: boolean; preview: string }>;
}
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 404 | `NOT_FOUND` | No `KnowledgeDocument` with this `id` in this organization. |

---

## `GET /api/retrieval/entity` — Entity Memory

**Method / Path**: `GET /api/retrieval/entity`
**File**: `apps/web/app/api/retrieval/entity/route.ts`
**Auth**: Delegates to `getEntityDetailService` (`requireRole(organizationId, ROLES.MEMBER)`) —
this route's own service function (`getEntityMemoryService`) does **not** call `requireRole`
itself; the gate is enforced one layer down.

**Reuses [Graph API](./graph.md)'s Entity Viewer data wholesale** — "entity memory" IS the entity's
full graph detail (node + relationships + timeline), nothing new computed. Identical response shape
to `GET /api/graph/entity/[id]`.

### Query params — `retrievalEntityQuerySchema`

```ts
{ id: string } // Entity.id
```

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 404 | `NOT_FOUND` | No `Entity` with this `id`. |

---

## `GET /api/retrieval/similar` — Find Similar

**Method / Path**: `GET /api/retrieval/similar`
**File**: `apps/web/app/api/retrieval/similar/route.ts`
**Auth**: `requireRole(organizationId, ROLES.MEMBER)`.

"More like this." Re-embeds the source's own stored `content` (cheap, and a deterministic provider
returns the same vector anyway) rather than reading the stored vector back out of Postgres —
`Embedding.vector` is an `Unsupported` Prisma type with no typed select path.

### Query params — `retrievalSimilarQuerySchema`

| Field | Type | Default | Notes |
|---|---|---|---|
| `sourceType` | enum | — | required: `CHUNK, NOTE, EMAIL, MEETING` |
| `sourceId` | string | — | required |
| `limit` | number | `10` | 1-50 |

### Response — `200`

`data: HybridSearchResult[]` — same shape as `GET /api/retrieval/search`, with `relationshipScore`
and `recencyScore` both always `0` (this path is pure vector similarity, no graph/recency signal).

### Errors

| Status | Code | When |
|---|---|---|
| 401 / 403 | `AUTH_ERROR` / `FORBIDDEN` | Auth/role failures. |
| 404 | `NOT_FOUND` | No embedding exists for `(sourceType, sourceId)`. |
| 422 | `VALIDATION_ERROR` | Malformed query. |

## Related docs

- [Bond & Conversations API](./bond.md) — `POST /api/bond/chat` is the only route that turns
  retrieval output into an LLM generation; every route in this file stops short of that.
- [Company Data API](./company-data.md#knowledge-library) — the Library upload pipeline that
  produces the chunks/embeddings this file's routes read and manage.
- [Graph API](./graph.md) — `GET /api/retrieval/entity`'s data source, and the relationship graph
  `relationshipScore` is computed from.
- [Search API](./search.md) — the simpler, non-semantic sibling of `GET /api/retrieval/search`.
