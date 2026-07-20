import { requireAuth } from '@bond-os/auth';

import { unlinkProjectFromSpaceService } from '@/features/spaces/services/space.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string; projectId: string }> };

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id, projectId } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  await unlinkProjectFromSpaceService(organizationId, user.id, id, projectId);
  return apiSuccess({ unlinked: true });
});
