import { requireAuth } from '@bond-os/auth';
import { delegateRequestSchema } from '@bond-os/shared';

import { runDelegateRequestService } from '@/features/agents/services/agent-delegate.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Explicit admin/debug invocation of one delegation hop — also what the Delegation Graph UI's "replay" affordance calls. */
export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, delegateRequestSchema);

  const result = await runDelegateRequestService(organizationId, user.id, body);

  return apiSuccess(result, { status: 201 });
});
