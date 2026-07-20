import { retrievalSearchQuerySchema } from '@bond-os/shared';

import { retrieve } from '@/features/retrieval/services/retrieval.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, retrievalSearchQuerySchema);
  const results = await retrieve(organizationId, query.q, { limit: query.limit });
  return apiSuccess(results);
});
