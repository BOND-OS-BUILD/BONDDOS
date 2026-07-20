import { requireAuth } from '@bond-os/auth';

import { leaveSpaceService, removeSpaceMemberService } from '@/features/spaces/services/space.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string; userId: string }> };

/** Leaving yourself needs no manage-permission check; removing someone else does — `removeSpaceMemberService` enforces that distinction. */
export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id, userId } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();

  if (userId === user.id) {
    await leaveSpaceService(organizationId, user.id, id);
  } else {
    await removeSpaceMemberService(organizationId, user.id, id, userId);
  }

  return apiSuccess({ removed: true });
});
