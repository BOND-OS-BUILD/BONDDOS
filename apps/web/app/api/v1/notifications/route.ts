import { ForbiddenError, paginationQuerySchema } from '@bond-os/shared';
import { z } from 'zod';

import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { listNotificationsPublic } from '@/features/api-v1/services/public-resources.service';
import { apiSuccess, parseQueryParams } from '@/lib/api-handler';

const notificationsQuerySchema = paginationQuerySchema.extend({
  read: z.coerce.boolean().optional(),
  archived: z.coerce.boolean().optional(),
  category: z
    .enum(['assigned', 'mentions', 'approvals', 'ai_insights', 'workflow_events', 'activity'])
    .optional(),
});

export const dynamic = 'force-dynamic';

export const GET = apiV1Handler('notifications:read', async (request, apiContext) => {
  if (!apiContext.userId) {
    throw new ForbiddenError('Notifications require a personal API key (an organization key has no inbox).');
  }
  const query = parseQueryParams(request, notificationsQuerySchema);
  return apiSuccess(
    await listNotificationsPublic(apiContext.organizationId, apiContext.userId, {
      page: query.page,
      pageSize: query.pageSize,
      read: query.read,
      archived: query.archived,
      category: query.category,
    }),
  );
});
