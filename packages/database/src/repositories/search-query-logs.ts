import type { SearchQuerySource } from '../generated';
import { prisma } from '../client';

/**
 * Phase 10 — search analytics log. No prior source existed for search queries;
 * the full-text search and RAG retrieval services now append here (best-effort,
 * never blocking the query). Backs the Search Analytics dashboard.
 */

export async function recordSearchQuery(input: {
  organizationId: string;
  userId?: string | null;
  query: string;
  source: SearchQuerySource;
  resultCount: number;
  durationMs?: number | null;
  citationCount?: number | null;
}): Promise<void> {
  await prisma.searchQueryLog.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      query: input.query.slice(0, 500),
      source: input.source,
      resultCount: input.resultCount,
      zeroResults: input.resultCount === 0,
      durationMs: input.durationMs ?? null,
      citationCount: input.citationCount ?? null,
    },
  });
}

export interface SearchAnalyticsData {
  totalQueries: number;
  zeroResultQueries: number;
  zeroResultRate: number;
  avgDurationMs: number;
  avgResultCount: number;
  avgCitationCount: number;
  topQueries: Array<{ query: string; count: number }>;
  topZeroResultQueries: Array<{ query: string; count: number }>;
}

export async function getSearchAnalytics(organizationId: string, since: Date): Promise<SearchAnalyticsData> {
  const where = { organizationId, createdAt: { gte: since } };
  const [totalQueries, zeroResultQueries, agg, topQueries, topZero] = await Promise.all([
    prisma.searchQueryLog.count({ where }),
    prisma.searchQueryLog.count({ where: { ...where, zeroResults: true } }),
    prisma.searchQueryLog.aggregate({ where, _avg: { durationMs: true, resultCount: true, citationCount: true } }),
    prisma.searchQueryLog.groupBy({
      by: ['query'],
      where,
      _count: { _all: true },
      orderBy: { _count: { query: 'desc' } },
      take: 10,
    }),
    prisma.searchQueryLog.groupBy({
      by: ['query'],
      where: { ...where, zeroResults: true },
      _count: { _all: true },
      orderBy: { _count: { query: 'desc' } },
      take: 10,
    }),
  ]);

  return {
    totalQueries,
    zeroResultQueries,
    zeroResultRate: totalQueries > 0 ? zeroResultQueries / totalQueries : 0,
    avgDurationMs: Math.round(agg._avg.durationMs ?? 0),
    avgResultCount: Number((agg._avg.resultCount ?? 0).toFixed(2)),
    avgCitationCount: Number((agg._avg.citationCount ?? 0).toFixed(2)),
    topQueries: topQueries.map((row) => ({ query: row.query, count: row._count._all })),
    topZeroResultQueries: topZero.map((row) => ({ query: row.query, count: row._count._all })),
  };
}
