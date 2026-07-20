'use client';

import * as React from 'react';

import { Spinner, toast } from '@bond-os/ui';

import { MessageBubble, type BondChatMessage } from '@/features/bond/components/message-bubble';
import { PromptBox } from '@/features/bond/components/prompt-box';
import { SourcePanel } from '@/features/bond/components/source-panel';
import { SuggestedQuestions } from '@/features/bond/components/suggested-questions';
import type { BondCitation } from '@/features/bond/lib/stream-events';

import { streamAgentChat, type AgentChatCallbacks } from '../lib/use-agent-chat';

export interface AgentChatThreadProps {
  conversationId: string;
  initialMessages: BondChatMessage[];
  /** Pins every turn to one agent (bypassing the Coordinator's auto-routing) — passed as `agentKey` on every `streamAgentChat` call when set. */
  initialAgentKey?: string;
}

type StreamStage = 'retrieving' | 'planning' | 'tool_call' | 'delegating' | 'generating';

const STAGE_LABEL: Record<StreamStage, string> = {
  retrieving: 'Retrieving…',
  planning: 'Thinking…',
  tool_call: 'Searching (tool)…',
  delegating: 'Delegating…',
  generating: 'Generating…',
};

/** A `BondChatMessage` plus which agent actually produced it — `MessageBubble` (generic, reused unchanged from the Bond feature) doesn't know about agents, so this thread tracks the extra field locally instead of forking that component. */
interface AgentChatMessage extends BondChatMessage {
  agentKey?: string;
}

/**
 * The agent-layer analogue of `features/bond/components/chat-thread.tsx` —
 * same optimistic-message/streaming-state shape (a USER message appended
 * immediately, a growing ASSISTANT message built from `token` events, a
 * stage indicator, citations/suggestions, abort-on-unmount), but driven by
 * `use-agent-chat.ts`'s `streamAgentChat` against `/api/agents/chat`
 * instead of `/api/bond/chat`. Composes the same generic
 * `MessageBubble`/`PromptBox`/`SourcePanel`/`SuggestedQuestions` from the
 * Bond feature unchanged — only the streaming plumbing differs. Whenever a
 * turn is answered by a specialist (not the Coordinator, `bond_coordinator`),
 * a small "Answered by {agentKey}" label is rendered above that turn's
 * bubble.
 */
export function AgentChatThread({ conversationId, initialMessages, initialAgentKey }: AgentChatThreadProps) {
  const [messages, setMessages] = React.useState<AgentChatMessage[]>(initialMessages);
  const [stage, setStage] = React.useState<StreamStage | null>(null);
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [selectedCitation, setSelectedCitation] = React.useState<BondCitation | null>(null);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, stage]);

  // Abort any in-flight stream if the thread unmounts (e.g. navigating away mid-response).
  React.useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function handleSend(content: string) {
    if (isStreaming) return;

    setSuggestions([]);
    setStage(null);

    const userMessage: AgentChatMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      role: 'USER',
      content,
      createdAt: new Date(),
    };
    const assistantId = `local-assistant-${crypto.randomUUID()}`;
    const assistantMessage: AgentChatMessage = {
      id: assistantId,
      role: 'ASSISTANT',
      content: '',
      citations: [],
      createdAt: new Date(),
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const callbacks: AgentChatCallbacks = {
      onStatus: (nextStage) => setStage(nextStage),
      onToken: (text, agentKey) => {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId ? { ...message, content: message.content + text, agentKey } : message,
          ),
        );
      },
      onCitations: (citations, agentKey) => {
        setMessages((prev) =>
          prev.map((message) => (message.id === assistantId ? { ...message, citations, agentKey } : message)),
        );
      },
      onSuggestions: (questions) => setSuggestions(questions),
      onDone: (event) => {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId ? { ...message, id: event.messageId, agentKey: event.agentKey } : message,
          ),
        );
        setStage(null);
        setIsStreaming(false);
      },
      onActionProposed: (event) => {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  id: event.messageId,
                  agentKey: event.agentKey,
                  actionProposal: {
                    planId: event.planId,
                    summary: event.summary,
                    steps: event.steps,
                    requiredRole: event.requiredRole,
                    estimatedTimeMs: event.estimatedTimeMs,
                    rollbackStrategy: event.rollbackStrategy,
                    expiresAt: event.expiresAt,
                  },
                }
              : message,
          ),
        );
        setStage(null);
        setIsStreaming(false);
      },
      onError: (message) => {
        toast.error(message);
        setStage(null);
        setIsStreaming(false);
        // Drop the placeholder if nothing was ever generated for it.
        setMessages((prev) => prev.filter((m) => !(m.id === assistantId && m.content.length === 0)));
      },
    };

    await streamAgentChat({ conversationId, content, agentKey: initialAgentKey }, callbacks, controller.signal);

    abortRef.current = null;
  }

  const lastMessage = messages[messages.length - 1];
  const showStageIndicator =
    isStreaming && stage !== null && lastMessage?.role === 'ASSISTANT' && lastMessage.content.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.map((message) => {
          const showAgentLabel =
            message.role === 'ASSISTANT' &&
            !!message.agentKey &&
            message.agentKey !== 'bond_coordinator' &&
            (message.content.length > 0 || !!message.actionProposal);

          if (!showAgentLabel) {
            return <MessageBubble key={message.id} message={message} onCitationClick={setSelectedCitation} />;
          }

          return (
            <div key={message.id} className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                Answered by {message.agentKey}
              </p>
              <MessageBubble message={message} onCitationClick={setSelectedCitation} />
            </div>
          );
        })}
        {showStageIndicator ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" />
            {STAGE_LABEL[stage as StreamStage]}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <SuggestedQuestions questions={suggestions} onSelect={handleSend} />

      <PromptBox onSend={handleSend} disabled={isStreaming} />

      <SourcePanel citation={selectedCitation} onClose={() => setSelectedCitation(null)} />
    </div>
  );
}
