import { ChatThread } from '@/features/bond/components/chat-thread';
import { parseActionProposal, type BondChatMessage } from '@/features/bond/components/message-bubble';
import type { BondCitation } from '@/features/bond/lib/stream-events';
import { getConversationService } from '@/features/bond/services/conversation.service';
import { listMessagesService } from '@/features/bond/services/message.service';
import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * The core "Mr. Bond" chat experience (spec §9) — a thin server component:
 * loads the conversation + its message history server-side (auth/role
 * checks happen inside the *Service calls, not here — see
 * conversation.service.ts / message.service.ts), then hands off to
 * `<ChatThread>`, which owns all further streaming state against
 * `POST /api/bond/chat`. Assumes the conversation row already exists — it's
 * created by the `/bond` CTA before navigating here.
 */
export default async function BondConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const organizationId = await requireActiveOrganizationId();

  const [conversation, messagesResult] = await Promise.all([
    getConversationService(organizationId, conversationId),
    listMessagesService(organizationId, conversationId, { page: 1, pageSize: 100 }),
  ]);

  const initialMessages: BondChatMessage[] = messagesResult.items
    .filter((message) => message.role === 'USER' || message.role === 'ASSISTANT')
    .map((message) => ({
      id: message.id,
      role: message.role as 'USER' | 'ASSISTANT',
      content: message.content,
      citations: (message.citations as BondCitation[] | null) ?? null,
      createdAt: message.createdAt,
      actionProposal: parseActionProposal(message.metadata),
    }));

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-4xl flex-col">
      <div className="mb-4">
        <h1 className="truncate text-xl font-semibold tracking-tight">
          {conversation.title ?? 'New conversation'}
        </h1>
      </div>
      <ChatThread conversationId={conversationId} initialMessages={initialMessages} />
    </div>
  );
}
