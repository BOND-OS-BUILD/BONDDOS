import { retrievalSimilarQuerySchema } from '@bond-os/shared';

import { findSimilar } from '@/features/retrieval/services/retrieval.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, retrievalSimilarQuerySchema);
  const results = await findSimilar(organizationId, query.sourceType, query.sourceId, {
    limit: query.limit,
  });
  return apiSuccess(results);
});
