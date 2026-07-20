import { removeConversationShareService } from '@/features/bond/services/conversation.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string; userId: string }> };

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id, userId } = await params;
  const organizationId = await requireActiveOrganizationId();
  await removeConversationShareService(organizationId, id, userId);
  return apiSuccess({ removed: true });
});
