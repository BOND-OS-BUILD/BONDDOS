import { requireAuth } from '@bond-os/auth';

import { markAllNotificationsReadService } from '@/features/notifications/services/notification.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const count = await markAllNotificationsReadService(organizationId, user.id);
  return apiSuccess({ count });
});
