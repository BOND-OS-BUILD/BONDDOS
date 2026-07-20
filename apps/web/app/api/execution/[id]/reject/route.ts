import { getApprovalService } from '@/features/execution/lib/container';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/**
 * Declines a proposed plan — the atomic PENDING -> REJECTED transition
 * (`ApprovalService.reject`) is what actually blocks `/approve` from ever
 * succeeding for this plan afterward. No role check beyond org membership:
 * rejecting only prevents a write, it can never cause one, so any member of
 * the org may decline it.
 */
export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const { id } = await params;

  await getApprovalService().reject(organizationId, id);

  return apiSuccess(null);
});
