import {
  getApprovalRequestByPlanId,
  getExecutionPlanById,
  getToolExecutionByPlanId,
  listExecutionSteps,
} from '@bond-os/database';
import { NotFoundError } from '@bond-os/shared';

import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/**
 * Read-only plan status, keyed by the `ExecutionPlan`'s own id (the
 * `planId`), not a `ToolExecution` id — a plan may still be awaiting
 * approval, in which case no `ToolExecution` exists yet. `execution`/`steps`
 * are `null`/`[]` in that case, which is a normal state, not an error.
 */
export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();

  const plan = await getExecutionPlanById(id, organizationId);
  if (!plan) {
    throw new NotFoundError('Execution plan not found.');
  }

  const [approval, execution] = await Promise.all([
    getApprovalRequestByPlanId(id, organizationId),
    getToolExecutionByPlanId(id, organizationId),
  ]);

  const steps = execution ? await listExecutionSteps(execution.id) : [];

  return apiSuccess({ plan, approval, execution, steps });
});
