import { executionListQuerySchema } from '@bond-os/shared';

import { listExecutionsService } from '@/features/execution/services/execution-history.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * Pending Approvals for the Workflow Automation dashboard (Phase 8).
 * `ApprovalService` (features/approvals/services/approval.service.ts) only
 * exposes single-plan lookups (`getForPlan`/`approve`/`reject`) — it has no
 * "list all pending for an org" method, and the `ApprovalRequest` repository
 * itself has no listing query either (only `getApprovalRequestByPlanId`).
 * So, per Phase 6's own established pattern, this reuses the exact same
 * `listExecutionsService` listing `/api/execution?status=AWAITING_APPROVAL`
 * already uses (see execution/route.ts), forcing `status` to
 * `AWAITING_APPROVAL` regardless of query input. Workflow-specific filtering
 * (matching a `WorkflowRunStep.planId` to these rows) is a nice-to-have not
 * implemented in this pass.
 */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, executionListQuerySchema);
  const result = await listExecutionsService(organizationId, { ...query, status: 'AWAITING_APPROVAL' });
  return apiSuccess(result);
});
