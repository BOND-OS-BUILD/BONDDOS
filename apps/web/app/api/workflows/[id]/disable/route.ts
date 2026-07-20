import { getWorkflowDefinitionService } from '@/features/workflows/lib/container';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** Disables an ACTIVE workflow so the Event Bus stops matching it — see `WorkflowDefinitionService.disable`. */
export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const { id } = await params;

  await getWorkflowDefinitionService().disable(id, organizationId);

  return apiSuccess({ success: true });
});
