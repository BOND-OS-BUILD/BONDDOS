import { retrievalEntityQuerySchema } from '@bond-os/shared';

import { getEntityMemoryService } from '@/features/retrieval/services/memory.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, retrievalEntityQuerySchema);
  const result = await getEntityMemoryService(organizationId, query.id);
  return apiSuccess(result);
});
