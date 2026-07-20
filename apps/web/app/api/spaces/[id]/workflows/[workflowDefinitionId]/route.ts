import { requireAuth } from '@bond-os/auth';

import { unlinkWorkflowFromSpaceService } from '@/features/spaces/services/space.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string; workflowDefinitionId: string }> };

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id, workflowDefinitionId } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  await unlinkWorkflowFromSpaceService(organizationId, user.id, id, workflowDefinitionId);
  return apiSuccess({ unlinked: true });
});
