import { requireAuth } from '@bond-os/auth';
import { planRequestSchema } from '@bond-os/shared';

import { proposeAction } from '@/features/planner/services/plan-proposal.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * The standalone build-a-plan-and-request-approval endpoint for non-chat
 * callers — Mr. Bond's in-pipeline `<<ACTION:...>>` handling calls
 * `proposeAction` directly instead of going through HTTP, so this route
 * omits `conversationId`. See docs/planner.md.
 */
export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, planRequestSchema);

  const result = await proposeAction({ organizationId, userId: user.id }, body);

  return apiSuccess(
    {
      planId: result.plan.id,
      summary: result.plan.summary,
      steps: result.steps,
      requiredRole: result.requiredRole,
      estimatedTimeMs: result.plan.estimatedTimeMs,
      rollbackStrategy: result.plan.rollbackStrategy,
      expiresAt: result.expiresAt.toISOString(),
    },
    { status: 201 },
  );
});
