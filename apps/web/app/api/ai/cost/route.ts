import { bondCostQuerySchema } from '@bond-os/shared';

import { getCostSummaryService } from '@/features/bond/services/cost-tracking.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, bondCostQuerySchema);
  const summary = await getCostSummaryService(organizationId, query);
  return apiSuccess(summary);
});
