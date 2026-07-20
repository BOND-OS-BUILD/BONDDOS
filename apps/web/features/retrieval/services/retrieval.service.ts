import { requireRole } from '@bond-os/auth';
import { logAiRequest, prisma, vectorSimilaritySearch, type EmbeddingSourceType } from '@bond-os/database';
import { NotFoundError, ROLES } from '@bond-os/shared';

import { getEmbeddingProvider } from '@/features/embeddings/services/embedding-provider.service';

import { hybridSearch, sourceTypeToKind, type HybridSearchResult } from './hybrid-search.service';

/**
 * The Retrieval Engine (spec §5): query preprocessing, hybrid search,
 * dedup + ranking (both already handled inside `hybridSearch`), permission
 * checks. Deliberately imports nothing from `@bond-os/ai`'s generation
 * surface or `@bond-os/embeddings`' provider directly (only `hybridSearch`
 * does, one layer down) — "No LLM calls. Only retrieve." is enforced by
 * this file's import list, not just a comment.
 */

function preprocessQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export interface RetrieveOptions {
  limit?: number;
}

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

export interface FindSimilarOptions {
  limit?: number;
}

/**
 * `/api/retrieval/similar` — "more like this." Re-embeds the source's own
 * stored `content` (cheap, and deterministic providers return the same
 * vector anyway) rather than reading the stored vector back out of Postgres
 * — `Embedding.vector` is `Unsupported`, so there's no typed way to select
 * it; re-embedding avoids needing to hand-parse pgvector's text
 * serialization for what's an interactive, not hot-path, lookup.
 */
export async function findSimilar(
  organizationId: string,
  sourceType: EmbeddingSourceType,
  sourceId: string,
  options: FindSimilarOptions = {},
): Promise<HybridSearchResult[]> {
  await requireRole(organizationId, ROLES.MEMBER);

  const source = await prisma.embedding.findFirst({
    where: { organizationId, sourceType, sourceId },
    select: { content: true },
  });
  if (!source) throw new NotFoundError('No embedding found for this source.');

  const provider = getEmbeddingProvider();
  const vector = await provider.generateEmbedding(source.content);
  const limit = options.limit ?? 10;

  const hits = await vectorSimilaritySearch(organizationId, vector, { limit: limit + 1 });

  return hits
    .filter((hit) => !(hit.sourceType === sourceType && hit.sourceId === sourceId))
    .slice(0, limit)
    .map((hit): HybridSearchResult => {
      const kind = sourceTypeToKind(hit.sourceType);
      return {
        key: `${kind}:${hit.sourceId}`,
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
        score: hit.similarity,
      };
    });
}
