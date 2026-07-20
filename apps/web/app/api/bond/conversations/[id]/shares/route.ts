import { shareConversationSchema } from '@bond-os/shared';

import { listConversationSharesService, shareConversationService } from '@/features/bond/services/conversation.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** Shared AI Sessions (Phase 9) — who a conversation is shared with. See docs/shared-ai.md. */
export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const shares = await listConversationSharesService(organizationId, id);
  return apiSuccess(shares);
});

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, shareConversationSchema);
  const share = await shareConversationService(organizationId, id, body);
  return apiSuccess(share, { status: 201 });
});
