'use client';

import * as React from 'react';

import { Spinner, toast } from '@bond-os/ui';

import { streamBondChat } from '../lib/use-bond-chat';
import type { BondCitation } from '../lib/stream-events';
import { MessageBubble, type BondChatMessage } from './message-bubble';
import { PromptBox } from './prompt-box';
import { SourcePanel } from './source-panel';
import { SuggestedQuestions } from './suggested-questions';

export interface ChatThreadProps {
  conversationId: string;
  initialMessages: BondChatMessage[];
}

type StreamStage = 'retrieving' | 'planning' | 'tool_call' | 'generating';

const STAGE_LABEL: Record<StreamStage, string> = {
  retrieving: 'Retrieving…',
  planning: 'Thinking…',
  tool_call: 'Searching (tool)…',
  generating: 'Generating…',
};

/**
 * Owns all streaming state for one conversation (spec §9's chat surface):
 * the message list (optimistic USER message appended immediately, a
 * growing ASSISTANT message built from `token` events), the current
 * `status` stage, citations/suggestions once they arrive, and error
 * handling. Composes `PromptBox` + `MessageBubble` + `SuggestedQuestions`
 * around `use-bond-chat.ts`'s `streamBondChat`.
 */
export function ChatThread({ conversationId, initialMessages }: ChatThreadProps) {
  const [messages, setMessages] = React.useState<BondChatMessage[]>(initialMessages);
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

    const userMessage: BondChatMessage = {
      id: `local-user-${crypto.randomUUID()}`,
      role: 'USER',
      content,
      createdAt: new Date(),
    };
    const assistantId = `local-assistant-${crypto.randomUUID()}`;
    const assistantMessage: BondChatMessage = {
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

    await streamBondChat(
      { conversationId, content },
      {
        onStatus: (nextStage) => setStage(nextStage),
        onToken: (text) => {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === assistantId ? { ...message, content: message.content + text } : message,
            ),
          );
        },
        onCitations: (citations) => {
          setMessages((prev) =>
            prev.map((message) => (message.id === assistantId ? { ...message, citations } : message)),
          );
        },
        onSuggestions: (questions) => setSuggestions(questions),
        onDone: (event) => {
          setMessages((prev) =>
            prev.map((message) => (message.id === assistantId ? { ...message, id: event.messageId } : message)),
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
      },
      controller.signal,
    );

    abortRef.current = null;
  }

  const lastMessage = messages[messages.length - 1];
  const showStageIndicator =
    isStreaming && stage !== null && lastMessage?.role === 'ASSISTANT' && lastMessage.content.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} onCitationClick={setSelectedCitation} />
        ))}
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
