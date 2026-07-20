import { prisma } from '../client';
import { Prisma, type EmbeddingSourceType } from '../generated/index.js';

/**
 * pgvector storage. `vector` is an `Unsupported("vector(1536)")` Prisma
 * field — it cannot be read or written through the normal Prisma Client, so
 * every actual vector read/write here goes through `$queryRaw`/`$executeRaw`.
 *
 * SECURITY: `vectorSimilaritySearch` below is the ONLY place a vector
 * similarity query is issued in this codebase. `organizationId` is filtered
 * in the SAME query as the vector distance operator, unconditionally, on
 * every call — never a global scan filtered afterward in application code.
 * See docs/vector-search.md.
 */

function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`;
}

export interface UpsertEmbeddingData {
  organizationId: string;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  content: string;
  embeddingModel: string;
  embeddingVersion: string;
  vector: number[];
}

/**
 * One current embedding per (organizationId, sourceType, sourceId) —
 * re-embedding replaces the row (typed columns via upsert, then the vector
 * via a follow-up raw UPDATE) rather than accumulating stale duplicates.
 * `organizationId` leads the compound unique key specifically so this WRITE
 * path is tenant-scoped at the database level, not only by virtue of every
 * caller pre-validating `sourceId` ownership before calling this function —
 * the same "org filter in the same query, not bolted on after" guarantee
 * `vectorSimilaritySearch` already gives the read path.
 */
export async function upsertEmbedding(data: UpsertEmbeddingData): Promise<{ id: string }> {
  const { organizationId, sourceType, sourceId, content, embeddingModel, embeddingVersion, vector } = data;

  const row = await prisma.embedding.upsert({
    where: { organizationId_sourceType_sourceId: { organizationId, sourceType, sourceId } },
    create: { organizationId, sourceType, sourceId, content, embeddingModel, embeddingVersion, dimensions: vector.length },
    update: { content, embeddingModel, embeddingVersion, dimensions: vector.length },
    select: { id: true },
  });

  const vectorLiteral = toVectorLiteral(vector);
  await prisma.$executeRaw`UPDATE embeddings SET vector = ${vectorLiteral}::vector WHERE id = ${row.id} AND "organizationId" = ${organizationId}`;

  return row;
}

export interface VectorSearchResult {
  id: string;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  content: string;
  /** `1 - cosine_distance` — higher is more similar. May land fractionally outside [0,1] due to floating point; callers should clamp before display. */
  similarity: number;
  createdAt: Date;
}

export interface VectorSearchOptions {
  sourceTypes?: EmbeddingSourceType[];
  limit?: number;
}

/**
 * Cosine-similarity search over `embeddings.vector` using pgvector's `<=>`
 * operator, ordered nearest-first. `organizationId` is always part of this
 * one query's WHERE clause — see the file-level security note above.
 */
export async function vectorSimilaritySearch(
  organizationId: string,
  queryVector: number[],
  options: VectorSearchOptions = {},
): Promise<VectorSearchResult[]> {
  const vectorLiteral = toVectorLiteral(queryVector);
  const limit = options.limit ?? 20;

  const sourceTypeFilter =
    options.sourceTypes && options.sourceTypes.length > 0
      ? Prisma.sql`AND "sourceType" IN (${Prisma.join(options.sourceTypes)})`
      : Prisma.empty;

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
}

/** Batched — avoids N+1 when the pipeline needs to know which sources already have an embedding before re-embedding them. */
export async function getEmbeddingsBySourceIds(
  organizationId: string,
  sourceType: EmbeddingSourceType,
  sourceIds: string[],
): Promise<Array<{ sourceId: string; embeddingModel: string; createdAt: Date }>> {
  if (sourceIds.length === 0) return [];
  return prisma.embedding.findMany({
    where: { organizationId, sourceType, sourceId: { in: sourceIds } },
    select: { sourceId: true, embeddingModel: true, createdAt: true },
  });
}

export async function deleteEmbeddingsForSource(
  organizationId: string,
  sourceType: EmbeddingSourceType,
  sourceId: string,
): Promise<boolean> {
  const result = await prisma.embedding.deleteMany({ where: { organizationId, sourceType, sourceId } });
  return result.count > 0;
}

export async function deleteAllEmbeddings(organizationId: string): Promise<number> {
  const result = await prisma.embedding.deleteMany({ where: { organizationId } });
  return result.count;
}

export interface EmbeddingStats {
  total: number;
  bySourceType: Array<{ sourceType: EmbeddingSourceType; count: number }>;
  lastEmbeddedAt: Date | null;
  lastModel: string | null;
}

export async function getEmbeddingStats(organizationId: string): Promise<EmbeddingStats> {
  const [total, bySourceType, latest] = await Promise.all([
    prisma.embedding.count({ where: { organizationId } }),
    prisma.embedding.groupBy({ by: ['sourceType'], where: { organizationId }, _count: { _all: true } }),
    prisma.embedding.findFirst({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, embeddingModel: true },
    }),
  ]);

  return {
    total,
    bySourceType: bySourceType.map((group) => ({ sourceType: group.sourceType, count: group._count._all })),
    lastEmbeddedAt: latest?.createdAt ?? null,
    lastModel: latest?.embeddingModel ?? null,
  };
}
