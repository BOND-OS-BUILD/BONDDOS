import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { graphAnalyticsPublic } from '@/features/api-v1/services/public-resources.service';
import { apiSuccess } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler('graph:read', async (_request, apiContext) => {
  return apiSuccess(await graphAnalyticsPublic(apiContext.organizationId));
});
