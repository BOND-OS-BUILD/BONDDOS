import { transferConversationOwnershipSchema } from '@bond-os/shared';

import { transferConversationOwnershipService } from '@/features/bond/services/conversation.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, transferConversationOwnershipSchema);
  const conversation = await transferConversationOwnershipService(organizationId, id, body.newOwnerId);
  return apiSuccess(conversation);
});
