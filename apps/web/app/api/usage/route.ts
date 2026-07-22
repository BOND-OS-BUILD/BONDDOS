import { analyticsWindowQuerySchema } from '@bond-os/shared';

import { getOrgUsageSummary } from '@/features/metering/services/metering.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Phase 10 — usage summary for the active organization (org ADMIN+). */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, analyticsWindowQuerySchema);
  return apiSuccess(await getOrgUsageSummary(organizationId, query));
});
