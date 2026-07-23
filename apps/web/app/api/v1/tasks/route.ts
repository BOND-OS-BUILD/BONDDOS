import { taskQuerySchema } from '@bond-os/shared';

import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { listTasksPublic } from '@/features/api-v1/services/public-resources.service';
import { apiSuccess, parseQueryParams } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler('tasks:read', async (request, apiContext) => {
  const query = parseQueryParams(request, taskQuerySchema);
  return apiSuccess(await listTasksPublic(apiContext.organizationId, query));
});
