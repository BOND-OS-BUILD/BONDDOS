import { getWorkflowRunService } from '@/features/workflows/lib/container';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** Cancels an in-flight run — see `WorkflowRunService.cancel`. */
export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const { id } = await params;

  await getWorkflowRunService().cancel(id, organizationId);

  return apiSuccess(null);
});
