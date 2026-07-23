import { paginationQuerySchema } from '@bond-os/shared';

import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { listWorkflowsPublic } from '@/features/api-v1/services/public-resources.service';
import { apiSuccess, parseQueryParams } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler('workflows:read', async (request, apiContext) => {
  const query = parseQueryParams(request, paginationQuerySchema);
  return apiSuccess(await listWorkflowsPublic(apiContext.organizationId, { page: query.page, pageSize: query.pageSize }));
});
