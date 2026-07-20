import { requireAuth } from '@bond-os/auth';

import { getGoalService } from '@/features/agents/lib/container';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** Runs exactly one more phase of the goal's cycle — never a background loop; only ever an explicit user trigger. */
export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const { id } = await params;

  const step = await getGoalService().advance(id, organizationId, user.id);

  return apiSuccess(step);
});
