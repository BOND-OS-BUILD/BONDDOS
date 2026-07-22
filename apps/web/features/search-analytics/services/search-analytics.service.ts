import { requireRole } from '@bond-os/auth';
import { getSearchAnalytics, recordSearchQuery, type SearchAnalyticsData } from '@bond-os/database';
import { ROLES, type AnalyticsWindowQuery } from '@bond-os/shared';
import { getRequestContext, logger } from '@bond-os/shared/server';

const log = logger.child('search-analytics');

export type SearchSource = 'FULL_TEXT' | 'RETRIEVAL' | 'HYBRID';

/**
 * Phase 10 — search analytics recording. Best-effort: a failed analytics
 * write must never break the search/retrieval it is observing. The current
 * user (if any) is pulled from the request context so call sites don't have
 * to thread it through.
 */
export async function recordSearchQuerySafe(input: {
  organizationId: string;
  query: string;
  source: SearchSource;
  resultCount: number;
  durationMs?: number;
  citationCount?: number;
}): Promise<void> {
  try {
    await recordSearchQuery({
      organizationId: input.organizationId,
      userId: getRequestContext()?.userId ?? null,
      query: input.query,
      source: input.source,
      resultCount: input.resultCount,
      durationMs: input.durationMs ?? null,
      citationCount: input.citationCount ?? null,
    });
  } catch (error) {
    log.warn('Failed to record search query', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface SearchAnalyticsResult extends SearchAnalyticsData {
  sinceDays: number;
}

/** Org-scoped Search Analytics (org ADMIN or OWNER). */
export async function getSearchAnalyticsService(
  organizationId: string,
  query: AnalyticsWindowQuery,
): Promise<SearchAnalyticsResult> {
  await requireRole(organizationId, ROLES.ADMIN);
  const since = new Date(Date.now() - query.sinceDays * 24 * 60 * 60 * 1000);
  const data = await getSearchAnalytics(organizationId, since);
  return { ...data, sinceDays: query.sinceDays };
}
