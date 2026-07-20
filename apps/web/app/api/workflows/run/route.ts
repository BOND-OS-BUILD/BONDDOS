import { workflowRunListQuerySchema } from '@bond-os/shared';

import { getWorkflowRunService } from '@/features/workflows/lib/container';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Workflow Runs — the execution history behind every workflow definition (Phase 8). See docs/workflows.md. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, workflowRunListQuerySchema);
  const result = await getWorkflowRunService().list({ organizationId, ...query });
  return apiSuccess(result);
});
