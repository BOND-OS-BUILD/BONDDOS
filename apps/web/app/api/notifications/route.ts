import { requireAuth } from '@bond-os/auth';
import { notificationListQuerySchema } from '@bond-os/shared';

import { listNotificationsService } from '@/features/notifications/services/notification.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** The caller's own notifications only — never another user's. See docs/notifications.md. */
export const GET = apiHandler(async (request) => {
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, notificationListQuerySchema);
  const result = await listNotificationsService(organizationId, user.id, query);
  return apiSuccess(result);
});
