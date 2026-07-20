# Vector Search (pgvector)

## Scope

This covers the storage and query side of Phase 4 specifically: the `embeddings` table's pgvector
column, why it has to be `Unsupported` in Prisma, the raw-SQL read/write path that column requires,
and the HNSW index that makes similarity search fast. See docs/embeddings.md for how the vectors
written here are generated. No cross-organization search of any kind is built — every path below
enforces tenant isolation in the same query as the vector operator itself, not as an afterthought.

## Why `Unsupported("vector(1536)")`

Prisma has no native vector column type. This is the same situation `tsvector` was already in for
full-text search (`packages/database/src/repositories/search.ts`) — no Prisma-managed column type,
so the actual `to_tsvector(...)` expression runs at raw-SQL query time instead. Phase 4 resolves the
pgvector column the same way: declare it as `Unsupported`, and do every real read/write through
`$queryRaw`/`$executeRaw`.

The real `Embedding` model (`packages/database/prisma/schema.prisma`, right after the `// ── Phase 4:
AI Memory & Retrieval Layer ──` banner):

```prisma
model Embedding {
  id               String              @id @default(cuid())
  organizationId   String
  sourceType       EmbeddingSourceType
  sourceId         String
  /// The exact text that was embedded — kept so citations don't need to re-derive it from the source row.
  content          String
  embeddingModel   String
  embeddingVersion String
  dimensions       Int
  vector           Unsupported("vector(1536)")?
  createdAt        DateTime            @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  /// One current embedding per source — re-embedding upserts (replaces), it never accumulates stale rows from a previous model.
  @@unique([organizationId, sourceType, sourceId])
  @@index([organizationId])
  @@map("embeddings")
}
```

`vector(1536)` is a fixed width, not a per-row/per-provider variable — 1536 is OpenAI's
`text-embedding-3-small` size, chosen because the HNSW index needs one constant dimension to build
against. Switching to a provider with a different native size still produces a 1536-length vector
(every provider's `dimensions()` defaults to 1536; see docs/embeddings.md), so the column doesn't
need to change.

## Schema additions: `postgresqlExtensions` + `extensions = [vector]`

Two additive lines onto the existing `generator client`/`datasource db` blocks — nothing else in
either block changed:

```prisma
generator client {
  provider        = "prisma-client-js"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}
```

Prisma's own migration diff automatically generated the extension statement from `extensions =
[vector]` — no hand-written SQL needed for this part:

```sql
CREATE EXTENSION IF NOT EXISTS "vector";
```

## Reads and writes: one repository function

The Prisma Client cannot touch an `Unsupported` field at all — not for reads, not for writes. Every
actual vector operation lives in `packages/database/src/repositories/embeddings.ts`.

**Write** — `upsertEmbedding` is two steps: a normal `prisma.embedding.upsert()` for every typed
column (`id`/`organizationId`/`sourceType`/`sourceId`/`content`/`embeddingModel`/
`embeddingVersion`/`dimensions`), followed by a raw `$executeRaw` that sets the vector column on the
row it just wrote:

```ts
const row = await prisma.embedding.upsert({
  where: { organizationId_sourceType_sourceId: { organizationId, sourceType, sourceId } },
  create: { organizationId, sourceType, sourceId, content, embeddingModel, embeddingVersion, dimensions: vector.length },
  update: { content, embeddingModel, embeddingVersion, dimensions: vector.length },
  select: { id: true },
});

const vectorLiteral = toVectorLiteral(vector);
await prisma.$executeRaw`UPDATE embeddings SET vector = ${vectorLiteral}::vector WHERE id = ${row.id} AND "organizationId" = ${organizationId}`;
```

`organizationId` leads the compound unique key (not just `[sourceType, sourceId]`) so this **write**
path is tenant-scoped at the database level too — an adversarial review of this phase's code
initially found the upsert's `where` clause omitted `organizationId` (relying entirely on every
caller pre-validating `sourceId` ownership before calling this function, which happened to hold for
every caller that existed at the time, but wasn't enforced by the schema itself). Fixed before this
phase shipped — see the compound key above and the `AND "organizationId" = ...` guard on the raw
`UPDATE`.

**Read** — every similarity read is `$queryRaw` using pgvector's `<=>` cosine-distance operator,
ordered nearest-first:

```ts
return prisma.$queryRaw<VectorSearchResult[]>`
  SELECT id, "sourceType", "sourceId", content, "createdAt",
    (1 - (vector <=> ${vectorLiteral}::vector))::float AS similarity
  FROM embeddings
  WHERE "organizationId" = ${organizationId}
    AND vector IS NOT NULL
    ${sourceTypeFilter}
  ORDER BY vector <=> ${vectorLiteral}::vector ASC
  LIMIT ${limit}
`;
```

Both live inside `vectorSimilaritySearch`, the single function that issues a vector similarity
query anywhere in this codebase.

## Security: tenant isolation is in the query, not after it

`vectorSimilaritySearch` always includes `WHERE "organizationId" = ${organizationId}` in the exact
same query as the `<=>` distance operator and `ORDER BY` — never a global scan across all
organizations filtered down to one org afterward in application code. This is deliberately
centralized in one repository function rather than re-implemented per caller, specifically so
cross-tenant leakage has exactly one place to get right, and exactly one place to audit.

## The HNSW index

Prisma has no concept of a pgvector index type, so — the same "hand-append what Prisma can't
generate" pattern already used for Phase 2's full-text-search GIN indexes — the HNSW index is
hand-appended directly to the migration SQL
(`packages/database/prisma/migrations/20260718000000_init/migration.sql`, search for `hnsw`):

```sql
CREATE INDEX "embeddings_vector_hnsw_idx" ON "embeddings" USING hnsw ("vector" vector_cosine_ops);
```

HNSW was chosen over IVFFlat because it doesn't need to be rebuilt/retrained as the table grows —
IVFFlat's clusters are computed from the data present at index-build time and degrade as more rows
are added, while HNSW's graph structure stays useful as the table grows, at the cost of slower
inserts and more memory during index build. An accepted tradeoff for a table that's written far
less often than it's queried.

## The four `EmbeddingSourceType` values

| Source type | What gets embedded | One row per |
| --- | --- | --- |
| `CHUNK` | `Chunk.content` | `Chunk` (a `KnowledgeDocument` may have many) |
| `NOTE` | `Entity.description` for `entityType = NOTE` | `Entity` (Phase 2 gave `NOTE` no dedicated table, so `description` is its only content) |
| `EMAIL` | `Email.subject` | `Email` (Phase 1's `Email` is metadata-only — no body field exists) |
| `MEETING` | `Meeting.agenda` + `Meeting.notes`, joined | `Meeting` |

## `@@unique([organizationId, sourceType, sourceId])`

Enforces one *current* embedding per source, per organization. Re-embedding a source (a new model, a
rebuild, a retry) upserts and replaces that row rather than accumulating stale duplicate rows left
over from a previous model — there is never more than one `embeddings` row to search per
`(organizationId, sourceType, sourceId)` triple.

## What's deliberately not built

- **No multi-embedding-per-source history/versioning.** `embeddingModel`/`embeddingVersion` are
  recorded on the row, but each re-embed replaces it — there's no table of prior vectors to diff or
  roll back to.
- **No cross-organization search of any kind.** `vectorSimilaritySearch` has no "search all orgs"
  mode, not even an admin one.
- **No approximate-nearest-neighbor tuning knobs exposed in UI.** HNSW's build-time parameters
  (`m`, `ef_construction`) and query-time `ef_search` all use pgvector's defaults — nothing in the
  product surfaces them yet.
