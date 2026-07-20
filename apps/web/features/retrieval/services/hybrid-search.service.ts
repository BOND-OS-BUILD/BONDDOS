import {
  listRelationshipsForEntities,
  prisma,
  searchEntities,
  vectorSimilaritySearch,
  type EmbeddingSourceType,
} from '@bond-os/database';

import { getEmbeddingProvider } from '@/features/embeddings/services/embedding-provider.service';

/**
 * Combines Phase 2's full-text search with Phase 4's vector similarity
 * search into one ranked list — the spec's 4 signals (text relevance,
 * semantic similarity, relationship proximity, recency). Organization scope
 * is a hard filter on both branches (enforced inside `searchEntities`/
 * `vectorSimilaritySearch` themselves), never a ranking weight.
 */

export type RetrievalSourceKind = 'ENTITY' | 'CHUNK' | 'EMAIL' | 'MEETING';

export interface HybridSearchResult {
  /** `${kind}:${id}` — stable identity used for dedup and citation resolution across this whole feature. */
  key: string;
  kind: RetrievalSourceKind;
  id: string;
  title: string;
  snippet: string;
  entityType: string | null;
  knowledgeDocumentId: string | null;
  createdAt: Date;
  textScore: number;
  semanticScore: number;
  relationshipScore: number;
  recencyScore: number;
  score: number;
}

const RECENCY_HALF_LIFE_DAYS = 30;
const WEIGHTS = { text: 0.35, semantic: 0.35, relationship: 0.2, recency: 0.1 };

function recencyScore(createdAt: Date): number {
  const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, Math.max(ageDays, 0) / RECENCY_HALF_LIFE_DAYS);
}

/** Min-max style normalization against the pool's own max (not a fixed scale) — every signal lands in [0,1] relative to this query's own candidates. */
function normalizer(values: number[]): (value: number) => number {
  const max = Math.max(0, ...values);
  if (max <= 0) return () => 0;
  return (value: number) => Math.max(0, Math.min(1, value / max));
}

/** NOTE embeddings key off the source Entity's id — the same identity space a plain Entity search hit uses — so a NOTE found by both branches merges into one candidate instead of appearing twice. Exported for `findSimilar`, which builds `HybridSearchResult`-shaped rows directly from vector hits without going through a full `hybridSearch` call. */
export function sourceTypeToKind(sourceType: EmbeddingSourceType): RetrievalSourceKind {
  return sourceType === 'NOTE' ? 'ENTITY' : sourceType;
}

export interface HybridSearchOptions {
  limit?: number;
}

export async function hybridSearch(
  organizationId: string,
  query: string,
  options: HybridSearchOptions = {},
): Promise<HybridSearchResult[]> {
  const limit = options.limit ?? 20;
  const candidatePoolSize = limit * 3;

  const provider = getEmbeddingProvider();
  const [textHits, queryVector] = await Promise.all([
    searchEntities(organizationId, query, candidatePoolSize),
    provider.generateEmbedding(query),
  ]);
  const vectorHits = await vectorSimilaritySearch(organizationId, queryVector, { limit: candidatePoolSize });

  const byKey = new Map<string, HybridSearchResult>();

  for (const hit of textHits) {
    const key = `ENTITY:${hit.id}`;
    byKey.set(key, {
      key,
      kind: 'ENTITY',
      id: hit.id,
      title: hit.title,
      snippet: hit.snippet,
      entityType: hit.entityType,
      knowledgeDocumentId: hit.knowledgeDocumentId,
      createdAt: new Date(0), // patched from a real batched lookup below
      textScore: hit.score,
      semanticScore: 0,
      relationshipScore: 0,
      recencyScore: 0,
      score: 0,
    });
  }

  for (const hit of vectorHits) {
    const kind = sourceTypeToKind(hit.sourceType);
    const key = `${kind}:${hit.sourceId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.semanticScore = Math.max(existing.semanticScore, hit.similarity);
      continue;
    }
    byKey.set(key, {
      key,
      kind,
      id: hit.sourceId,
      title: hit.content.slice(0, 80),
      snippet: hit.content.slice(0, 240),
      entityType: kind === 'ENTITY' ? 'NOTE' : null,
      knowledgeDocumentId: null,
      createdAt: hit.createdAt,
      textScore: 0,
      semanticScore: hit.similarity,
      relationshipScore: 0,
      recencyScore: 0,
      score: 0,
    });
  }

  const entityCandidates = Array.from(byKey.values()).filter((candidate) => candidate.kind === 'ENTITY');
  if (entityCandidates.length > 0) {
    const entityIds = entityCandidates.map((candidate) => candidate.id);

    const [entities, edges] = await Promise.all([
      prisma.entity.findMany({ where: { id: { in: entityIds }, organizationId }, select: { id: true, createdAt: true } }),
      listRelationshipsForEntities(entityIds, organizationId),
    ]);

    const createdAtById = new Map(entities.map((entity) => [entity.id, entity.createdAt]));
    for (const candidate of entityCandidates) {
      candidate.createdAt = createdAtById.get(candidate.id) ?? candidate.createdAt;
    }

    const idSet = new Set(entityIds);
    const connectionCounts = new Map<string, number>();
    for (const edge of edges) {
      if (!idSet.has(edge.sourceEntity.id) || !idSet.has(edge.targetEntity.id)) continue;
      connectionCounts.set(edge.sourceEntity.id, (connectionCounts.get(edge.sourceEntity.id) ?? 0) + 1);
      connectionCounts.set(edge.targetEntity.id, (connectionCounts.get(edge.targetEntity.id) ?? 0) + 1);
    }
    const normalizeRelationship = normalizer(Array.from(connectionCounts.values()));
    for (const candidate of entityCandidates) {
      candidate.relationshipScore = normalizeRelationship(connectionCounts.get(candidate.id) ?? 0);
    }
  }

  const allCandidates = Array.from(byKey.values());
  for (const candidate of allCandidates) {
    candidate.recencyScore = recencyScore(candidate.createdAt);
  }

  const normalizeText = normalizer(allCandidates.map((candidate) => candidate.textScore));
  const normalizeSemantic = normalizer(allCandidates.map((candidate) => candidate.semanticScore));

  for (const candidate of allCandidates) {
    candidate.textScore = normalizeText(candidate.textScore);
    candidate.semanticScore = normalizeSemantic(candidate.semanticScore);
    candidate.score =
      candidate.textScore * WEIGHTS.text +
      candidate.semanticScore * WEIGHTS.semantic +
      candidate.relationshipScore * WEIGHTS.relationship +
      candidate.recencyScore * WEIGHTS.recency;
  }

  return allCandidates.sort((a, b) => b.score - a.score).slice(0, limit);
}
