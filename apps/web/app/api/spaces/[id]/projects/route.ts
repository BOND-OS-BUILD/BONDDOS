import { requireAuth } from '@bond-os/auth';
import { linkSpaceProjectSchema } from '@bond-os/shared';

import { linkProjectToSpaceService } from '@/features/spaces/services/space.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, linkSpaceProjectSchema);
  await linkProjectToSpaceService(organizationId, user.id, id, body.projectId);
  return apiSuccess({ linked: true });
});
