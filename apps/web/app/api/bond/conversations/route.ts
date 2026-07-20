import { requireAuth } from '@bond-os/auth';
import { conversationQuerySchema, createConversationSchema } from '@bond-os/shared';

import {
  createConversationService,
  listConversationsService,
} from '@/features/bond/services/conversation.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

/** The chat thread list (spec §9) — scoped to the caller's own conversations. */
export const GET = apiHandler(async (request) => {
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, conversationQuerySchema);
  const result = await listConversationsService(organizationId, user.id, query);
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createConversationSchema);
  const created = await createConversationService(organizationId, user.id, body);
  return apiSuccess(created, { status: 201 });
});
