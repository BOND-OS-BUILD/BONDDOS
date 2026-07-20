import { getWorkflowDefinitionService } from '@/features/workflows/lib/container';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** Freezes a DRAFT into an immutable, versioned ACTIVE row — see `WorkflowDefinitionService.publish`. */
export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const { id } = await params;

  const definition = await getWorkflowDefinitionService().publish(id, organizationId);

  return apiSuccess(definition);
});
