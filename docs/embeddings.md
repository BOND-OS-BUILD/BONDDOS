# Embeddings

## Scope

Phase 4 builds the **pluggable embedding-provider architecture** and the pipeline that calls it: a
provider interface, four real network-backed provider implementations, one deterministic
zero-config local fallback, and a retryable job-tracking model — the same shape Phase 2 built for
sync. Notes/Emails/Meetings deliberately have **no automatic embedding hook** into their own Phase 1
create paths; that's a scoping decision explained below, not a bug. No chat, no retrieval-augmented
generation, no agents — just "text in, vector out" and a durable record of every attempt. See
docs/vector-search.md for how the resulting vectors are stored and queried, and docs/ai-service.md
for the (separate) generation/chat provider layer.

## The `EmbeddingProvider` interface (`packages/embeddings`)

```ts
export interface EmbeddingProvider {
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  dimensions(): number;
  providerName(): string;
}
```

`generateEmbedding`/`dimensions`/`providerName` are the spec's own interface, verbatim;
`generateEmbeddings` is an additive batch method. `BaseEmbeddingProvider`
(`packages/embeddings/src/base-provider.ts`) gives every provider a default `generateEmbeddings`
that just calls `generateEmbedding` N times sequentially — a provider with a native batch endpoint
(OpenAI, Voyage, Gemini, Ollama's `/api/embed`) overrides it with a single real batched request.

## Five providers (`packages/embeddings/src/providers/`)

Four are real, fetch-based REST calls to each provider's actual embeddings API:

- `openai.ts` — `POST {baseUrl}/v1/embeddings`, native batch via an array `input`.
- `gemini.ts` — `POST .../models/{model}:embedContent` (single) and `:batchEmbedContents` (batch).
- `voyage.ts` — `POST https://api.voyageai.com/v1/embeddings`.
- `ollama.ts` — `POST {baseUrl}/api/embed` against a local Ollama server, its newer unified
  endpoint (supports batch, unlike the older single-text `/api/embeddings`).

The fifth, `local-hash.ts`, is the zero-config default (`EMBEDDING_PROVIDER` unset, or set to
`LOCAL`) — deterministic feature-hashing (the "hashing trick"), real math, no ML model, no network
call, no API key:

```ts
/** FNV-1a — fast, deterministic, no external dependency. */
function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
```

Each token (word, plus adjacent-word bigrams) is FNV-1a hashed into a bucket
(`hash % dimensions`), its sign taken from the hash's low bit, and the resulting vector is
L2-normalized before it's returned. It rewards lexical/word overlap between texts, not semantic
meaning — a real, useful local fallback for development and testing, not a stand-in for a real
model's quality. This matches this codebase's established pattern of every pluggable interface
having a working default with no secrets required — `Cache`, `Queue`, and `RateLimiter` in
`packages/shared` all work the same way.

## `createEmbeddingProvider` is a pure factory

`packages/embeddings/src/registry.ts`'s `createEmbeddingProvider(config)` switches on
`config.provider` and instantiates the matching class. It does **not** read environment variables —
same reasoning as `packages/connectors` having no env awareness: it keeps `packages/embeddings`
dependency-free and testable in isolation with an explicit config object.

The actual env-var composition happens one layer up, in
`apps/web/features/embeddings/services/embedding-provider.service.ts`'s `getEmbeddingProvider()`,
which is the one place env vars and the provider factory meet:

```ts
export function getEmbeddingProvider(): EmbeddingProvider {
  const env = getEnv();
  if (cachedProvider && cachedProviderId === env.EMBEDDING_PROVIDER) {
    return cachedProvider;
  }

  cachedProvider = createEmbeddingProvider({
    provider: env.EMBEDDING_PROVIDER,
    dimensions: env.EMBEDDING_DIMENSIONS,
    openai: env.OPENAI_API_KEY
      ? { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_EMBEDDING_MODEL || env.EMBEDDING_MODEL || undefined }
      : undefined,
    ...
  });
  ...
}
```

## Environment variables

All optional (`packages/shared/src/env.ts`, `.env.example`) — the zero-config default means the
whole embedding pipeline works with no secrets configured at all:

| Variable | Default | Notes |
| --- | --- | --- |
| `EMBEDDING_PROVIDER` | `LOCAL` | `LOCAL \| OPENAI \| GEMINI \| VOYAGE \| OLLAMA` |
| `EMBEDDING_MODEL` | unset | generic override, provider-specific fallback |
| `EMBEDDING_DIMENSIONS` | `1536` | passed through to whichever provider is active |
| `OPENAI_API_KEY` / `OPENAI_EMBEDDING_MODEL` | unset | required only if `EMBEDDING_PROVIDER=OPENAI` |
| `GEMINI_API_KEY` | unset | required only if `EMBEDDING_PROVIDER=GEMINI` |
| `VOYAGE_API_KEY` | unset | required only if `EMBEDDING_PROVIDER=VOYAGE` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | no key needed, Ollama runs locally |

`createEmbeddingProvider` throws a clear, immediate error if a real provider is selected but its key
is missing — it never silently falls back to a different provider than the one requested.

## The embedding pipeline (`apps/web/features/embeddings/services/embedding-pipeline.service.ts`)

### Library uploads: one additive hook

`embedDocumentChunks` is called from **one** additive hook inside
`apps/web/features/library/services/library.service.ts`'s private `parseAndChunk`, right after the
existing Phase 3 Smart Linking hook, wrapped in its own `try`/`catch` so a failure here is never
fatal to the upload:

```ts
try {
  const storedChunks = await listChunks(id, organizationId);
  await embedDocumentChunks({
    organizationId,
    documentEntityId: entityId,
    chunks: storedChunks.map((chunk) => ({ id: chunk.id, content: chunk.content })),
  });
} catch (error) {
  // never allowed to break the upload, same as Smart Linking
}
```

`embedDocumentChunks` batches **one real provider call for every chunk** via `generateEmbeddings`
(Performance §16's "batch embedding generation"), but creates **one `EmbeddingJob` row per chunk**
(not one for the whole document) — so a single malformed vector in an otherwise-successful batch can
be retried individually instead of re-embedding the whole document. On success it appends a
`TimelineEvent` with `eventType: 'AI_ACTION'` — the first real use of that enum value, which Phase 3
reserved specifically for this ("`AI_ACTION` was reserved in Phase 3 for 'future AI actions'" — see
the schema comment on `TimelineEventType`).

### Notes/Emails/Meetings: on-demand, not automatic

Notes, Emails, and Meetings do **not** get an automatic embedding hook into their own (Phase 1)
create paths. Wiring one in would mean modifying `meeting.service.ts`/`email.service.ts`, which
"don't modify existing functionality" forbids. Instead, their embeddings are generated on demand:

- `generateEmbeddingForSourceService(organizationId, { sourceType, sourceId })` — the manual-trigger
  path (e.g. `POST /api/embeddings`), resolving each source's only embeddable content: `NOTE` reads
  `Entity.description` (Phase 2 gave `NOTE` no dedicated table), `EMAIL` reads `Email.subject`
  (Phase 1's `Email` is metadata-only, no body field), `MEETING` reads `agenda` + `notes` joined
  together.
- `rebuildVectorsService(organizationId)` — the bulk path, ADMIN-gated: deletes every embedding in
  the org and regenerates all of them (chunks, notes, emails, meetings) from scratch.

### `EmbeddingJob`: mirrors Phase 2's `SyncJob`

`EmbeddingJob` is one row per embedding *attempt* — the same shape and the same honesty as Phase 2's
`SyncJob`: `status` (PENDING/RUNNING/SUCCEEDED/FAILED/RETRYING), `jobType`
(GENERATE/REINDEX/REBUILD/DELETE), `provider`, `errorMessage`, `retryCount`,
`startedAt`/`completedAt`. There is no real background worker consuming these — see "What's
deliberately not built" below.

`retryFailedEmbeddingJobsService(organizationId)` finds every `FAILED` job in the org, marks each
`RETRYING`, re-resolves its source content, and re-attempts the embed — incrementing `retryCount` and
landing back on `SUCCEEDED` or `FAILED`.

## Dimension-mismatch safety

Before any vector is written, the pipeline checks the generated vector's length against
`provider.dimensions()`:

```ts
if (vector.length !== provider.dimensions()) {
  throw new Error(`Embedding dimension mismatch: provider returned ${vector.length}, expected ${provider.dimensions()}.`);
}
```

A mismatch fails the job with a clear message instead of writing a corrupt row into `embeddings` —
see docs/vector-search.md for why the column has one fixed width (`vector(1536)`).

## What's deliberately not built

- **No real background worker/scheduler.** `getQueue().enqueue(...)` is called at every entry point
  to demonstrate the queue architecture, but nothing consumes it — the same "queue exists, no
  processor" state every prior phase's `Queue` is in. Jobs run synchronously inside the request that
  triggers them.
- **No per-provider model auto-discovery** beyond a static default-model table. Listing available
  models (`listModels()`) is the AI Service Layer's concern (docs/ai-service.md), not embeddings.
- **No automatic re-embedding on provider switch.** Changing `EMBEDDING_PROVIDER` does not touch
  existing rows — re-embedding everything is the explicit, manual `rebuildVectorsService` action, not
  something that happens implicitly on the next request.
