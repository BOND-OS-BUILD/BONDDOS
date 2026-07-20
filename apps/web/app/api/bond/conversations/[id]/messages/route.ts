import { messageQuerySchema } from '@bond-os/shared';

import { listMessagesService } from '@/features/bond/services/message.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/**
 * Read-only message history for a conversation. Deliberately GET-only —
 * sending a message happens exclusively through the RAG pipeline
 * (`/api/bond/chat`'s SSE stream), never through a plain create-message
 * endpoint, so no second write path can bypass retrieval.
 */
export const GET = apiHandler<Context>(async (request, { params }) => {
  const { id } = await params;
  const query = parseQueryParams(request, messageQuerySchema);
  const organizationId = await requireActiveOrganizationId();
  const result = await listMessagesService(organizationId, id, query);
  return apiSuccess(result);
});
