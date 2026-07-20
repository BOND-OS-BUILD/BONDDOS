import { requireAuth } from '@bond-os/auth';

import { joinSpaceService } from '@/features/spaces/services/space.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** Joining is self-service — any org member can join any Space. See docs/spaces.md. */
export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  await joinSpaceService(organizationId, user.id, id);
  return apiSuccess({ joined: true });
});
