import { requireAuth } from '@bond-os/auth';
import { createGoalSchema, goalListQuerySchema } from '@bond-os/shared';

import { getGoalService } from '@/features/agents/lib/container';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Long-running Goals — Plan -> Observe -> Suggest -> Wait -> Continue. See docs/goals.md. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, goalListQuerySchema);
  const result = await getGoalService().listGoals(organizationId, query);
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createGoalSchema);

  const goal = await getGoalService().createGoal(organizationId, user.id, body);

  return apiSuccess(goal, { status: 201 });
});
