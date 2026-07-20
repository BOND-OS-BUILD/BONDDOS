import { AgentChatThread } from '@/features/agents/components/agent-chat-thread';
import { getAgentService } from '@/features/agents/services/agent-discovery.service';
import { parseActionProposal, type BondChatMessage } from '@/features/bond/components/message-bubble';
import type { BondCitation } from '@/features/bond/lib/stream-events';
import { getConversationService } from '@/features/bond/services/conversation.service';
import { listMessagesService } from '@/features/bond/services/message.service';
import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * A single agent-pinned chat thread — mirrors
 * `bond/[conversationId]/page.tsx` exactly (server-loads the conversation +
 * message history, then hands off to a client thread component for
 * streaming), except every turn is pinned to `agentKey` via
 * `AgentChatThread`'s `initialAgentKey`, bypassing the Coordinator's
 * auto-routing. `Conversation`/`Message` are a shared model, not
 * Bond-exclusive (`runAgentChatPipeline` writes to the very same tables),
 * so `conversation.service.ts` / `message.service.ts` are reused unchanged
 * here rather than duplicated. Reached from the "Chat with {agent}" button
 * on the agent detail page, which creates the `Conversation` row first.
 */
export default async function AgentConversationPage({
  params,
}: {
  params: Promise<{ agentKey: string; conversationId: string }>;
}) {
  const { agentKey, conversationId } = await params;
  const organizationId = await requireActiveOrganizationId();

  const [agent, conversation, messagesResult] = await Promise.all([
    getAgentService(organizationId, agentKey),
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
          {conversation.title ?? (agent ? `Chat with ${agent.displayName}` : 'New conversation')}
        </h1>
      </div>
      <AgentChatThread conversationId={conversationId} initialMessages={initialMessages} initialAgentKey={agentKey} />
    </div>
  );
}
