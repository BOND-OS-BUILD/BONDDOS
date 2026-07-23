import { customerQuerySchema } from '@bond-os/shared';

import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { listCustomersPublic } from '@/features/api-v1/services/public-resources.service';
import { apiSuccess, parseQueryParams } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler('customers:read', async (request, apiContext) => {
  const query = parseQueryParams(request, customerQuerySchema);
  return apiSuccess(await listCustomersPublic(apiContext.organizationId, query));
});
