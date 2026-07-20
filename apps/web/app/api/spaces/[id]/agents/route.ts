import { requireAuth } from '@bond-os/auth';
import { linkSpaceAgentSchema } from '@bond-os/shared';

import { linkAgentToSpaceService } from '@/features/spaces/services/space.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, linkSpaceAgentSchema);
  await linkAgentToSpaceService(organizationId, user.id, id, body.agentKey);
  return apiSuccess({ linked: true });
});
