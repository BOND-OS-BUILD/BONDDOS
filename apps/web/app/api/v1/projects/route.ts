import { projectQuerySchema } from '@bond-os/shared';

import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { listProjectsPublic } from '@/features/api-v1/services/public-resources.service';
import { apiSuccess, parseQueryParams } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler('projects:read', async (request, apiContext) => {
  const query = parseQueryParams(request, projectQuerySchema);
  return apiSuccess(await listProjectsPublic(apiContext.organizationId, query));
});
