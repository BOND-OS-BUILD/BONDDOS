import { requireAuth } from '@bond-os/auth';

import { getUnreadNotificationCountService } from '@/features/notifications/services/notification.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async () => {
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const count = await getUnreadNotificationCountService(organizationId, user.id);
  return apiSuccess({ count });
});
