# Embeddings

## Scope

`packages/embeddings` is BOND OS's **vector-embedding** provider abstraction — a distinct package
and a distinct provider-id space from `packages/ai` (the text-generation side — see
[Providers](./providers.md)). This doc covers the embedding-provider interface, its five concrete
implementations (four real network-backed providers plus a deterministic zero-config local
fallback), the app-layer pipeline that calls them (`embedding-pipeline.service.ts`), and the
pgvector storage layer underneath. For how the resulting vectors are actually *searched*, see
[Retrieval](./retrieval.md) (`vectorSimilaritySearch`/`hybridSearch`); for the raw storage
mechanics in more depth, see [Vector Search](../database/schema.md).

## Generation vs. embeddings: two independent provider axes

It's worth being explicit that `AIProviderId` (generation, [Providers](./providers.md)) and
`EmbeddingProviderId` (this doc) are **not the same enum** and do not overlap except at one id:

```ts
// packages/ai/src/types.ts
export type AIProviderId = 'OPENAI' | 'ANTHROPIC' | 'GEMINI' | 'OLLAMA';

// packages/embeddings/src/types.ts
export type EmbeddingProviderId = 'OPENAI' | 'GEMINI' | 'VOYAGE' | 'OLLAMA' | 'LOCAL';
```

`ANTHROPIC` only exists for generation (Anthropic has no embeddings API this codebase integrates
with); `VOYAGE` and `LOCAL` only exist for embeddings. `OLLAMA` is the only id both axes share. These
are two fully independent configuration choices — an org can legitimately run
`EMBEDDING_PROVIDER=LOCAL` for embeddings while `AI_PROVIDER=ANTHROPIC` drives chat generation,
simultaneously.

## The `EmbeddingProvider` interface

`packages/embeddings/src/types.ts`:

```ts
export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  dimensions(): number;
  providerName(): string;
}
```

`BaseEmbeddingProvider` (`packages/embeddings/src/base-provider.ts`) gives every provider a default
`generateEmbeddings` that just calls `generateEmbedding` N times sequentially:

```ts
export abstract class BaseEmbeddingProvider implements EmbeddingProvider {
  abstract generateEmbedding(text: string): Promise<number[]>;
  abstract dimensions(): number;
  abstract providerName(): string;

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) results.push(await this.generateEmbedding(text));
    return results;
  }
}
```

A provider with a native batch endpoint (OpenAI, Voyage, Gemini, Ollama's `/api/embed`) overrides
this with one real batched HTTP request instead.

## Five providers

| Provider | Endpoint(s) | Default model | Default dims | Batch support |
|---|---|---|---|---|
| `OpenAiEmbeddingProvider` | `POST {baseUrl}/embeddings`, default `https://api.openai.com/v1` | `text-embedding-3-small` | 1536 | Native — array `input`, response re-sorted by `index` before returning. |
| `GeminiEmbeddingProvider` | `POST .../models/{model}:embedContent?key=` (single) / `:batchEmbedContents?key=` (batch) | `text-embedding-004` | 768 | Native batch endpoint, separate URL suffix from the single-text one. |
| `VoyageEmbeddingProvider` | `POST https://api.voyageai.com/v1/embeddings` | `voyage-3` | 1024 | Native — array `input`, response re-sorted by `index`. |
| `OllamaEmbeddingProvider` | `POST {baseUrl}/api/embed`, default `http://localhost:11434` | `nomic-embed-text` | 768 | Native — the newer unified `/api/embed` endpoint (supports batch, unlike the older single-text `/api/embeddings`). |
| `LocalHashEmbeddingProvider` | none — no network call at all | n/a (`providerName() = 'local'`) | 1536 (configurable) | Trivially "batchable" via the base class's sequential loop — each call is already synchronous local math. |

All four network providers are real, complete `fetch`-based REST clients — none is a stub. OpenAI
requests an explicit `dimensions` field in the body (`{ model, input, dimensions }`); Gemini
requests `outputDimensionality`; Voyage and Ollama don't take a dimensions parameter in the request
at all — their embedding size is fixed per model, and the configured `dimensions` value is only used
locally for the [dimension-mismatch check](#dimension-mismatch-safety) after the response comes
back.

## `LocalHashEmbeddingProvider` — the deterministic zero-config default

`packages/embeddings/src/providers/local-hash.ts` — real math, no ML model, no network call, no API
key, always succeeds:

```ts
function tokenize(text: string): string[] {
  const words = text.toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const tokens = [...words];
  for (let i = 0; i < words.length - 1; i++) tokens.push(`${words[i]}_${words[i + 1]}`); // adjacent-word bigrams
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

generateEmbedding(text: string): Promise<number[]> {
  const vector = new Array<number>(this.dimensionCount).fill(0);
  for (const token of tokenize(text)) {
    const hash = fnv1a(token);
    const index = hash % this.dimensionCount;
    const sign = hash & 1 ? 1 : -1;
    vector[index] = (vector[index] ?? 0) + sign;
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return Promise.resolve(magnitude === 0 ? vector : vector.map((value) => value / magnitude));
}
```

The algorithm, step by step:

1. **Tokenize**: lowercase, NFKD-normalize (splits accented characters into base + combining marks),
   strip everything but `a-z0-9` and whitespace, split on whitespace — then append every
   adjacent-word bigram (`word_i_word_i+1`) as an additional token, so short phrase overlap
   contributes to similarity too, not just single-word overlap.
2. **Feature hash** ("the hashing trick"): each token's FNV-1a hash picks a bucket
   (`hash % dimensions`) and a sign (`hash & 1`), and that ±1 is accumulated into the vector at that
   index — collisions between different tokens hashing to the same bucket are possible and are not
   detected or resolved, by design (this is what makes it a fixed-size hash rather than a full
   vocabulary-indexed sparse vector).
3. **L2-normalize** so cosine-similarity comparisons behave the same way they would against a real
   model's unit vectors.

This is the **zero-config default** — `EMBEDDING_PROVIDER` unset, or `LOCAL`, or (see below)
anything the registry doesn't otherwise recognize. It rewards lexical/word overlap between texts,
not semantic meaning — a real, useful local fallback for development and testing, not a stand-in for
a real embedding model's quality. It matches this codebase's established pattern of every pluggable
interface (`Cache`, `Queue`, `RateLimiter` in `packages/shared`) having a working default with no
secrets required.

## `createEmbeddingProvider` — a pure factory that always succeeds for `LOCAL`

`packages/embeddings/src/registry.ts`:

```ts
export function createEmbeddingProvider(config: EmbeddingRegistryConfig): EmbeddingProvider {
  switch (config.provider) {
    case 'OPENAI':
      if (!config.openai?.apiKey) throw new Error('EMBEDDING_PROVIDER=OPENAI requires OPENAI_API_KEY.');
      return new OpenAiEmbeddingProvider({ apiKey: config.openai.apiKey, model: config.openai.model, dimensions: config.dimensions });
    case 'GEMINI': /* same shape, requires GEMINI_API_KEY */
    case 'VOYAGE': /* same shape, requires VOYAGE_API_KEY */
    case 'OLLAMA':
      return new OllamaEmbeddingProvider({ model: config.ollama?.model, baseUrl: config.ollama?.baseUrl, dimensions: config.dimensions });
    case 'LOCAL':
    default:
      return new LocalHashEmbeddingProvider({ dimensions: config.dimensions });
  }
}
```

Note the `default:` case falls through to the **same** branch as `LOCAL` — an unrecognized or
missing `provider` value doesn't throw here, it silently becomes the local hash provider. This is a
deliberate asymmetry with [`packages/ai`'s `createAIProvider`](./providers.md#createaiprovider--a-pure-factory-no-local-fallback),
which throws on an unknown provider id — embeddings always has a working, if low-quality, fallback;
generation deliberately does not (a fake generator would be actively misleading; a hash-based vector
is a legitimate, if weak, embedding). Real providers (`OPENAI`/`GEMINI`/`VOYAGE`) still throw
immediately if selected without their required key — the factory never silently swaps to a different
*real* provider than the one requested, only ever to the local fallback when nothing valid was
selected at all.

This is a pure factory — no env-var reading — same reasoning as `packages/connectors` having no env
awareness: it keeps `packages/embeddings` dependency-free and testable in isolation.

## Composition root: `apps/web/features/embeddings/services/embedding-provider.service.ts`

The one place env vars and the provider factory meet:

```ts
let cachedProvider: EmbeddingProvider | undefined;
let cachedProviderId: string | undefined;

export function getEmbeddingProvider(): EmbeddingProvider {
  const env = getEnv();
  if (cachedProvider && cachedProviderId === env.EMBEDDING_PROVIDER) return cachedProvider;

  cachedProvider = createEmbeddingProvider({
    provider: env.EMBEDDING_PROVIDER,
    dimensions: env.EMBEDDING_DIMENSIONS,
    openai: env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_EMBEDDING_MODEL || env.EMBEDDING_MODEL || undefined } : undefined,
    gemini: env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY, model: env.EMBEDDING_MODEL || undefined } : undefined,
    voyage: env.VOYAGE_API_KEY ? { apiKey: env.VOYAGE_API_KEY, model: env.EMBEDDING_MODEL || undefined } : undefined,
    ollama: { baseUrl: env.OLLAMA_BASE_URL, model: env.EMBEDDING_MODEL || undefined },
  });
  cachedProviderId = env.EMBEDDING_PROVIDER;
  return cachedProvider;
}
```

Cached by `env.EMBEDDING_PROVIDER` and rebuilt automatically if that value changes (relevant mainly
in tests/dev where env can be swapped without a process restart).

```ts
const DEFAULT_MODEL_BY_PROVIDER: Record<string, string> = {
  OPENAI: 'text-embedding-3-small', GEMINI: 'text-embedding-004',
  VOYAGE: 'voyage-3', OLLAMA: 'nomic-embed-text', LOCAL: 'local-hash-v1',
};

export function getEmbeddingModelLabel(): string { /* resolves the exact model string to record on an Embedding row */ }

export function isEmbeddingProviderConfigured(): boolean {
  switch (getEnv().EMBEDDING_PROVIDER) {
    case 'OPENAI': return Boolean(env.OPENAI_API_KEY);
    case 'GEMINI': return Boolean(env.GEMINI_API_KEY);
    case 'VOYAGE': return Boolean(env.VOYAGE_API_KEY);
    case 'OLLAMA': case 'LOCAL': default: return true;
  }
}
```

`isEmbeddingProviderConfigured()` is `true` unconditionally for `OLLAMA`/`LOCAL`/anything
unrecognized — reflecting the registry's own "always has a fallback" posture.

## Environment variables

All optional (`packages/shared/src/env.ts`) — the zero-config default means the whole embedding
pipeline works with no secrets configured at all:

| Variable | Default | Notes |
|---|---|---|
| `EMBEDDING_PROVIDER` | `LOCAL` | `LOCAL \| OPENAI \| GEMINI \| VOYAGE \| OLLAMA` |
| `EMBEDDING_MODEL` | unset | Generic override; provider-specific env vars (below) take precedence where they exist. |
| `EMBEDDING_DIMENSIONS` | `1536` | Passed through to whichever provider is active. |
| `OPENAI_API_KEY` / `OPENAI_EMBEDDING_MODEL` | unset | Required only if `EMBEDDING_PROVIDER=OPENAI`; `OPENAI_API_KEY` is shared with [generation's OpenAI provider](./providers.md). |
| `GEMINI_API_KEY` | unset | Required only if `EMBEDDING_PROVIDER=GEMINI`; shared with generation's Gemini provider. |
| `VOYAGE_API_KEY` | unset | Required only if `EMBEDDING_PROVIDER=VOYAGE` — no generation counterpart exists for this key. |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Shared with generation's Ollama provider; no key needed either way. |

## The embedding pipeline (`apps/web/features/embeddings/services/embedding-pipeline.service.ts`)

### What gets embedded, per source type

`EmbeddingSourceType` has exactly four values (`packages/database/prisma/schema.prisma`):

```prisma
enum EmbeddingSourceType {
  CHUNK
  NOTE
  EMAIL
  MEETING
}
```

- **`CHUNK`** — the normal case, a `KnowledgeDocument` may have many; content is already in hand at
  the call site, no separate resolution needed.
- **`NOTE`** — embeds `Entity.description`. Phase 2 gave `NOTE` no dedicated table, so `description`
  is its only content.
- **`EMAIL`** — embeds `Email.subject`. Phase 1's `Email` is metadata-only; there is no body field to
  embed.
- **`MEETING`** — embeds `agenda` + `notes` joined with `\n\n`.

```ts
async function resolveSourceContent(organizationId, sourceType, sourceId): Promise<string | null> {
  if (sourceType === 'NOTE') { /* Entity.description, entityType: 'NOTE' */ }
  if (sourceType === 'EMAIL') { /* Email.subject */ }
  /* MEETING: [meeting.agenda, meeting.notes].filter(Boolean).join('\n\n') */
}
```

Note this is a **different** four-value set from [Retrieval](./retrieval.md)'s
`RetrievalSourceKind = 'ENTITY' | 'CHUNK' | 'EMAIL' | 'MEETING'` — `NOTE` (an embedding source) maps
to `ENTITY` (a retrieval-result kind) via `sourceTypeToKind()` in `hybrid-search.service.ts`, since a
NOTE *is* an `Entity` row. `CHUNK`/`EMAIL`/`MEETING` pass through unchanged in both directions.

### Library uploads: one additive hook

`embedDocumentChunks` is called from one additive hook inside
`apps/web/features/library/services/library.service.ts`'s upload flow, right after the Phase 3 Smart
Linking hook, wrapped in its own `try`/`catch` so a failure here is never fatal to the upload itself.

```ts
export async function embedDocumentChunks(input: EmbedChunksInput): Promise<void> {
  const { organizationId, documentEntityId, chunks } = input;
  if (chunks.length === 0) return;

  const provider = getEmbeddingProvider();
  await getQueue().enqueue('generate-embeddings', { organizationId, documentEntityId, chunkCount: chunks.length });

  const jobs = await Promise.all(chunks.map((chunk) => createEmbeddingJob({ organizationId, jobType: 'GENERATE', sourceType: 'CHUNK', sourceId: chunk.id, provider: provider.providerName() })));

  let vectors: number[][];
  try {
    vectors = await provider.generateEmbeddings(chunks.map((chunk) => chunk.content)); // ONE real batch call
  } catch (error) {
    await Promise.all(jobs.map((job) => completeEmbeddingJob(job.id, organizationId, { status: 'FAILED', errorMessage: errorMessage(error) })));
    return; // total batch failure — every job marked FAILED, never throws up to the upload caller
  }

  let succeeded = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    // per-chunk: dimension check, upsertEmbedding, completeEmbeddingJob(SUCCEEDED|FAILED) independently
  }

  await logAiRequest({ organizationId, action: 'embedding.generate_chunks', provider: provider.providerName(), metadata: { documentEntityId, chunkCount: chunks.length, succeeded } });
  if (succeeded > 0) {
    await appendTimelineEvent({ organizationId, entityId: documentEntityId, eventType: 'AI_ACTION', description: `Generated ${succeeded} of ${chunks.length} embedding(s) via ${provider.providerName()}.` });
  }
}
```

**One real provider call for the whole batch** (`generateEmbeddings`), but **one `EmbeddingJob` row
per chunk** — deliberately, so a single malformed vector in an otherwise-successful batch can be
retried individually rather than re-embedding the entire document. If the whole batch call itself
throws (e.g. provider is down), every job for that batch is marked `FAILED` individually and the
function returns without re-throwing — it never breaks the upload request that triggered it.
`eventType: 'AI_ACTION'` is the first real use of that `TimelineEvent` enum value, reserved back in
Phase 3 for exactly this.

### Notes/Emails/Meetings: on-demand, not automatic

Notes, Emails, and Meetings deliberately get **no automatic embedding hook** into their own (Phase 1)
create paths — wiring one in would mean modifying `meeting.service.ts`/`email.service.ts` themselves.
Instead:

- **`generateEmbeddingForSourceService(organizationId, { sourceType, sourceId })`** — the
  manual-trigger path (`ROLES.MEMBER`), creates one `EmbeddingJob`, resolves content via
  `resolveSourceContent`, embeds, and marks the job `SUCCEEDED`/`FAILED`. Throws `NotFoundError` if
  the source has no embeddable content (e.g. an empty description).
- **`rebuildVectorsService(organizationId)`** — the bulk path, **`ROLES.ADMIN`-gated**: deletes every
  `Embedding` row in the org (`deleteAllEmbeddings`), then re-embeds every document's chunks plus
  every note/email/meeting. Individual re-embed failures are caught and logged per-item — one bad
  source never aborts the whole rebuild.
- **`deleteEmbeddingForSourceService(organizationId, sourceType, sourceId)`** — also
  **`ROLES.ADMIN`-gated**; throws `NotFoundError` if nothing was deleted.
- **`reindexDocumentService(organizationId, knowledgeDocumentId)`** — re-embeds every existing chunk
  of one document (for switching embedding models on that document), not a re-parse — parsing is the
  unrelated upload pipeline's job.
- **`retryFailedEmbeddingJobsService(organizationId)`** — finds every `FAILED` job in the org, marks
  each `RETRYING`, re-resolves content fresh (chunk content re-read from `prisma.chunk` directly, or
  `resolveSourceContent` for the other three types), and re-attempts.

### Dimension-mismatch safety

Before any vector is written, the pipeline checks the generated vector's length against the active
provider's declared dimensionality:

```ts
if (vector.length !== provider.dimensions()) {
  throw new Error(`Embedding dimension mismatch: provider returned ${vector.length}, expected ${provider.dimensions()}.`);
}
```

A mismatch fails the job with a clear error message rather than writing a corrupt row into
`embeddings` — the pgvector column has one fixed width (`vector(1536)`) because the HNSW index needs
a constant dimension; see [Vector Search / Schema](../database/schema.md) for what changing
providers/dimensions actually requires (a full `rebuildVectorsService` run, since existing rows at a
different width can't coexist with a new width in the same indexed column in a meaningful way).

### `EmbeddingJob` mirrors Phase 2's `SyncJob`

```prisma
model EmbeddingJob {
  id             String              @id @default(cuid())
  organizationId String
  jobType        EmbeddingJobType    @default(GENERATE) // GENERATE | REINDEX | REBUILD | DELETE
  sourceType     EmbeddingSourceType
  sourceId       String
  status         EmbeddingJobStatus  @default(PENDING)  // PENDING | RUNNING | SUCCEEDED | FAILED | RETRYING
  provider       String?
  errorMessage   String?
  retryCount     Int                 @default(0)
  startedAt      DateTime?
  completedAt    DateTime?
  createdAt      DateTime            @default(now())
}
```

One row per embedding **attempt** — the same shape and the same honesty as Phase 2's `SyncJob`: a
durable, queryable record of every generate/reindex/rebuild/delete attempt and how it ended.

## Queue-but-no-worker: a repo-wide pattern, confirmed here too

Every entry point above calls `getQueue().enqueue(...)` first
(`embedDocumentChunks`, `generateEmbeddingForSourceService`, `reindexDocumentService`,
`rebuildVectorsService`, `deleteEmbeddingForSourceService`). This demonstrates the queue
architecture, but **nothing in the codebase consumes those queue entries** — no worker/consumer file
exists anywhere for embedding jobs. Every actual embedding job runs **synchronously, inline, within
the same request/call that enqueued it**, confirmed by reading straight through each function above:
`enqueue()` is called, then the real work happens immediately afterward in the same async function,
not handed off. This is the identical "queue exists, no processor" pattern already documented for
Phase 2's `SyncJob`/`Queue` — stated plainly here rather than implied.

## Storage layer: `packages/database/src/repositories/embeddings.ts`

`Embedding.vector` is declared as `Unsupported("vector(1536)")` in Prisma — pgvector has no native
Prisma type, so this column **cannot be read or written through the normal Prisma Client at all**.
Every actual vector read/write goes through `$queryRaw`/`$executeRaw`:

```ts
export async function upsertEmbedding(data: UpsertEmbeddingData): Promise<{ id: string }> {
  const row = await prisma.embedding.upsert({
    where: { organizationId_sourceType_sourceId: { organizationId, sourceType, sourceId } },
    create: { organizationId, sourceType, sourceId, content, embeddingModel, embeddingVersion, dimensions: vector.length },
    update: { content, embeddingModel, embeddingVersion, dimensions: vector.length },
    select: { id: true },
  }); // typed columns first, via normal Prisma Client

  const vectorLiteral = toVectorLiteral(vector); // "[0.1,0.2,...]"
  await prisma.$executeRaw`UPDATE embeddings SET vector = ${vectorLiteral}::vector WHERE id = ${row.id} AND "organizationId" = ${organizationId}`;
  return row;
}
```

Two-step write: typed columns via a normal Prisma `upsert` (keyed on the compound unique
`[organizationId, sourceType, sourceId]` — one current embedding per source, re-embedding replaces
rather than accumulating stale duplicates), then the vector itself via a raw `UPDATE`. **The
`AND "organizationId" = ${organizationId}` guard on that raw UPDATE is deliberate and documented** —
both in the code comment and in the schema's own comment on `Embedding.@@unique` — as closing a
tenant-isolation gap on the write path specifically, not only relying on every caller to have
pre-validated `sourceId` ownership before calling this function.

```ts
export async function vectorSimilaritySearch(organizationId, queryVector, options = {}): Promise<VectorSearchResult[]> {
  const vectorLiteral = toVectorLiteral(queryVector);
  return prisma.$queryRaw<VectorSearchResult[]>`
    SELECT id, "sourceType", "sourceId", content, "createdAt",
      (1 - (vector <=> ${vectorLiteral}::vector))::float AS similarity
    FROM embeddings
    WHERE "organizationId" = ${organizationId} AND vector IS NOT NULL ${sourceTypeFilter}
    ORDER BY vector <=> ${vectorLiteral}::vector ASC
    LIMIT ${limit}
  `;
}
```

This is **the only place a vector similarity query is issued anywhere in the codebase** — the file's
own comment states this and it holds up against the code: [Hybrid Search](./retrieval.md) and the
standalone "more like this" retrieval path both call through this one function, never raw SQL of
their own. `organizationId` is in the **same** `WHERE` clause as the `<=>` distance operator on every
call — never a global scan filtered after the fact in application code. `similarity` is
`1 - cosine_distance`, which "may land fractionally outside `[0,1]` due to floating point; callers
should clamp before display" (the type's own comment).

```mermaid
flowchart TD
    A["Source content\n(chunk text / Entity.description /\nEmail.subject / agenda+notes)"] --> B["getEmbeddingProvider()\n(cached by EMBEDDING_PROVIDER)"]
    B --> C{"provider.generateEmbedding(s)\n(real API call, or local hash)"}
    C -->|vector length mismatch| F["EmbeddingJob -> FAILED\nno row written"]
    C -->|matches provider.dimensions()| D["upsertEmbedding()\ntyped upsert + raw UPDATE ... vector ...\nAND organizationId = $org"]
    D --> E["EmbeddingJob -> SUCCEEDED"]
    D --> G["embeddings table\n(pgvector, vector(1536))"]
    G --> H["vectorSimilaritySearch()\nthe ONLY <=> query site,\norg-scoped in the same WHERE"]
```

## What's deliberately not built

- **No real background worker/scheduler.** `getQueue().enqueue(...)` demonstrates the architecture;
  nothing consumes it — see [above](#queue-but-no-worker-a-repo-wide-pattern-confirmed-here-too).
- **No per-provider model auto-discovery** beyond the static `DEFAULT_MODEL_BY_PROVIDER` table.
  Listing generation models (`listModels()`) is a [Providers](./providers.md) concern; there is no
  equivalent for embedding models.
- **No automatic re-embedding on provider switch.** Changing `EMBEDDING_PROVIDER` does not touch
  existing rows — re-embedding everything is the explicit, manual `rebuildVectorsService` action.
- **No automatic embedding hook for Notes/Emails/Meetings** — on-demand only, by design (see above).

## Related docs

- [Providers](./providers.md) — the separate, four-provider *generation* side.
- [Retrieval](./retrieval.md) — Hybrid Search's semantic-signal branch, the main consumer of
  `vectorSimilaritySearch`.
- [Context Builder](./context-builder.md) — how retrieved chunks/entities (including
  embedding-matched ones) become part of a prompt.
- [Database Schema](../database/schema.md) — `Embedding`/`EmbeddingJob` in the context of the full
  schema, and pgvector/HNSW indexing details.
- [Organization Isolation](../security/organization-isolation.md) — the tenant-scoping guarantee
  `upsertEmbedding`/`vectorSimilaritySearch` both enforce in-query.
- [AI API](../api/ai.md) — the `/api/embeddings/*` routes this service layer backs.
