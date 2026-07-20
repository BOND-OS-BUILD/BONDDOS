import { requireRole } from '@bond-os/auth';
import { getConversationById, listMessages, type MessageItem } from '@bond-os/database';
import { NotFoundError, ROLES, type MessageQuery, type PaginatedResult } from '@bond-os/shared';

import { assertConversationAccess } from './conversation.service';

/** Read-only message history for a conversation — sending a message happens exclusively through the RAG pipeline (`/api/bond/chat`), never through a plain create-message endpoint, so "every answer goes through retrieval" can't be bypassed by a second write path. */

export async function listMessagesService(
  organizationId: string,
  conversationId: string,
  query: MessageQuery,
): Promise<PaginatedResult<MessageItem>> {
  const { session, membership } = await requireRole(organizationId, ROLES.MEMBER);
  const conversation = await getConversationById(conversationId, organizationId);
  if (!conversation) throw new NotFoundError('Conversation not found.');
  await assertConversationAccess(conversation, session.user.id, membership.role, 'read');
  return listMessages({ conversationId, organizationId, ...query });
}
