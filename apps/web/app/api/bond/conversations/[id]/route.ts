import { updateConversationSchema } from '@bond-os/shared';

import {
  deleteConversationService,
  getConversationService,
  updateConversationService,
} from '@/features/bond/services/conversation.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const conversation = await getConversationService(organizationId, id);
  return apiSuccess(conversation);
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, updateConversationSchema);
  const conversation = await updateConversationService(organizationId, id, body);
  return apiSuccess(conversation);
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  await deleteConversationService(organizationId, id);
  return apiSuccess(null);
});
