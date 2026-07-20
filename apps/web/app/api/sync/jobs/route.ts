import { syncJobQuerySchema } from '@bond-os/shared';

import { listSyncJobsService } from '@/features/sync/services/sync.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, syncJobQuerySchema);
  const result = await listSyncJobsService(organizationId, query);
  return apiSuccess(result);
});
