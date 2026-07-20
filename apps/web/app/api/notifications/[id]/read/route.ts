import { requireAuth } from '@bond-os/auth';

import { markNotificationReadService } from '@/features/notifications/services/notification.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  await markNotificationReadService(organizationId, user.id, id);
  return apiSuccess({ id });
});
