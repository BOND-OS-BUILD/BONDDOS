import { meetingQuerySchema } from '@bond-os/shared';

import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { listMeetingsPublic } from '@/features/api-v1/services/public-resources.service';
import { apiSuccess, parseQueryParams } from '@/lib/api-handler';

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler('meetings:read', async (request, apiContext) => {
  const query = parseQueryParams(request, meetingQuerySchema);
  return apiSuccess(await listMeetingsPublic(apiContext.organizationId, query));
});
