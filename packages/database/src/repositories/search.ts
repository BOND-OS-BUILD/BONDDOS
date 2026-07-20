import { prisma } from '../client';
import type { EntityType } from '../generated/index.js';

/**
 * PostgreSQL full-text search (no AI/semantic search). Uses `$queryRaw`
 * tagged templates — Prisma auto-parameterizes interpolated values, so this
 * is safe against SQL injection despite being raw SQL. There's no
 * Prisma-managed `tsvector` column (Prisma has no first-class type for one
 * without hand-editing generated migrations), so `to_tsvector(...)` runs at
 * query time; the migration adds a matching expression GIN index for
 * performance. See docs/search.md.
 */

export interface EntitySearchResult {
  id: string;
  entityType: EntityType;
  title: string;
  description: string | null;
  /** The KnowledgeDocument row's own id, when `entityType` is DOCUMENT/FILE — `/library/[id]` resolves by this, NOT by `id` (the Entity id). Null for entity types with no KnowledgeDocument detail row. */
  knowledgeDocumentId: string | null;
  snippet: string;
  score: number;
}

export async function searchEntities(
  organizationId: string,
  query: string,
  limit = 5,
): Promise<EntitySearchResult[]> {
  return prisma.$queryRaw<EntitySearchResult[]>`
    SELECT
      e.id,
      e."entityType" AS "entityType",
      e.title,
      e.description,
      kd.id AS "knowledgeDocumentId",
      ts_headline(
        'english',
        coalesce(e.description, e.title),
        websearch_to_tsquery('english', ${query}),
        'MaxWords=30, MinWords=10'
      ) AS snippet,
      ts_rank(
        to_tsvector('english', e.title || ' ' || coalesce(e.description, '')),
        websearch_to_tsquery('english', ${query})
      )::float AS score
    FROM entities e
    LEFT JOIN knowledge_documents kd ON kd."entityId" = e.id
    WHERE e."organizationId" = ${organizationId}
      AND to_tsvector('english', e.title || ' ' || coalesce(e.description, ''))
          @@ websearch_to_tsquery('english', ${query})
    ORDER BY score DESC
    LIMIT ${limit}
  `;
}

export interface DocumentContentSearchResult {
  id: string;
  entityId: string;
  title: string;
  snippet: string;
  score: number;
}

/** Searches inside parsed document text, not just title/description. */
export async function searchKnowledgeDocumentContent(
  organizationId: string,
  query: string,
  limit = 5,
): Promise<DocumentContentSearchResult[]> {
  return prisma.$queryRaw<DocumentContentSearchResult[]>`
    SELECT
      kd.id,
      kd."entityId" AS "entityId",
      e.title,
      ts_headline(
        'english',
        coalesce(kd."parsedText", ''),
        websearch_to_tsquery('english', ${query}),
        'MaxWords=30, MinWords=10'
      ) AS snippet,
      ts_rank(
        to_tsvector('english', coalesce(kd."parsedText", '')),
        websearch_to_tsquery('english', ${query})
      )::float AS score
    FROM knowledge_documents kd
    JOIN entities e ON e.id = kd."entityId"
    WHERE kd."organizationId" = ${organizationId}
      AND kd."parsedText" IS NOT NULL
      AND to_tsvector('english', kd."parsedText") @@ websearch_to_tsquery('english', ${query})
    ORDER BY score DESC
    LIMIT ${limit}
  `;
}
