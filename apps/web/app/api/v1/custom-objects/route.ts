import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { listCustomObjectsPublic } from '@/features/api-v1/services/custom-objects-public.service';
import { apiSuccess } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler('custom-objects:read', async (_request, apiContext) => {
  return apiSuccess(await listCustomObjectsPublic(apiContext.organizationId));
});
