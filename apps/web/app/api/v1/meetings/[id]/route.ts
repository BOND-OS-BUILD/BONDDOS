import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { getMeetingPublic } from '@/features/api-v1/services/public-resources.service';
import { apiSuccess } from '@/lib/api-handler';

type Context = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler<Context>('meetings:read', async (_request, apiContext, { params }) => {
  const { id } = await params;
  return apiSuccess(await getMeetingPublic(apiContext.organizationId, id));
});
