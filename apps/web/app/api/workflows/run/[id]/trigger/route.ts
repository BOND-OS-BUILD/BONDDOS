import { requireAuth } from '@bond-os/auth';
import { triggerManualWorkflowSchema } from '@bond-os/shared';

import { getWorkflowRunService } from '@/features/workflows/lib/container';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/**
 * The MANUAL trigger / "Run Now" button — despite living under `run/`, `id`
 * here is the `WorkflowDefinition.id` being triggered, not a run id; this
 * endpoint starts a brand-new `WorkflowRun`. See `WorkflowRunService.triggerManual`.
 */
export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const { id } = await params;
  const body = await parseJsonBody(request, triggerManualWorkflowSchema);

  const run = await getWorkflowRunService().triggerManual(organizationId, user.id, id, body.payload);

  return apiSuccess(run, { status: 201 });
});
