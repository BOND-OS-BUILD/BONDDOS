import { executionListQuerySchema } from '@bond-os/shared';

import { listExecutionsService } from '@/features/execution/services/execution-history.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, executionListQuerySchema);
  const result = await listExecutionsService(organizationId, query);
  return apiSuccess(result);
});
