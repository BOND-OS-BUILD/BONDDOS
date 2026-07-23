import { documentQuerySchema } from '@bond-os/shared';

import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { listDocumentsPublic } from '@/features/api-v1/services/public-resources.service';
import { apiSuccess, parseQueryParams } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler('documents:read', async (request, apiContext) => {
  const query = parseQueryParams(request, documentQuerySchema);
  return apiSuccess(await listDocumentsPublic(apiContext.organizationId, query));
});
