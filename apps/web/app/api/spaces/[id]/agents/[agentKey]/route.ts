import { requireAuth } from '@bond-os/auth';

import { unlinkAgentFromSpaceService } from '@/features/spaces/services/space.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string; agentKey: string }> };

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id, agentKey } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  await unlinkAgentFromSpaceService(organizationId, user.id, id, agentKey);
  return apiSuccess({ unlinked: true });
});
