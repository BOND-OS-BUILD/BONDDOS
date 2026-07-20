import { retrievalContextQuerySchema } from '@bond-os/shared';

import { buildContext } from '@/features/retrieval/services/context-builder.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, retrievalContextQuerySchema);
  const result = await buildContext(organizationId, query.q, query.tokenBudget);
  return apiSuccess(result);
});
