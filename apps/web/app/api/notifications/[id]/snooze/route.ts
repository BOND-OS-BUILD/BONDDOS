import { requireAuth } from '@bond-os/auth';
import { snoozeNotificationSchema } from '@bond-os/shared';

import { snoozeNotificationService } from '@/features/notifications/services/notification.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, snoozeNotificationSchema);
  await snoozeNotificationService(organizationId, user.id, id, body.snoozedUntil);
  return apiSuccess({ id });
});
