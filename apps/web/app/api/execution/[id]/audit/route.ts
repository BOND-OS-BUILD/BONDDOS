import { getToolExecutionByPlanId } from '@bond-os/database';
import { executionAuditQuerySchema } from '@bond-os/shared';

import { getAuditService } from '@/features/execution/lib/container';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/**
 * Read-only audit trail for a plan's execution, keyed by the `ExecutionPlan`'s
 * own id (the `planId`). If the plan hasn't been approved/executed yet there
 * is no `ToolExecution` row and therefore nothing to audit — that's a normal
 * empty state, not a 404.
 */
export const GET = apiHandler<Context>(async (request, { params }) => {
  const { id } = await params;
  const query = parseQueryParams(request, executionAuditQuerySchema);
  const organizationId = await requireActiveOrganizationId();

  const execution = await getToolExecutionByPlanId(id, organizationId);
  if (!execution) {
    return apiSuccess({ items: [], page: query.page, pageSize: query.pageSize, total: 0, totalPages: 1 });
  }

  const result = await getAuditService().listForExecution(organizationId, execution.id, query);
  return apiSuccess(result);
});
