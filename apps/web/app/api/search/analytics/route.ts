import { analyticsWindowQuerySchema } from '@bond-os/shared';

import { getSearchAnalyticsService } from '@/features/search-analytics/services/search-analytics.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Phase 10 — search analytics for the active organization (org ADMIN+). */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, analyticsWindowQuerySchema);
  return apiSuccess(await getSearchAnalyticsService(organizationId, query));
});
