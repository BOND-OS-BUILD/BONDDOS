'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare } from 'lucide-react';

import { ROUTES } from '@bond-os/shared';
import { Button, toast, type ButtonProps } from '@bond-os/ui';

export interface StartAgentChatButtonProps {
  agentKey: string;
  agentDisplayName: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  className?: string;
}

interface CreatedConversation {
  id: string;
}

/**
 * Creates a new `Conversation` row and navigates to
 * `/agents/[agentKey]/[conversationId]`, where `AgentChatThread` mounts
 * pinned to this agent (`initialAgentKey`). Reuses `POST /api/bond/conversations`
 * unchanged rather than a new agent-specific endpoint — `Conversation` is a
 * shared model, not Bond-exclusive; `runAgentChatPipeline` itself
 * get-or-creates against the very same table. Mirrors
 * `features/bond/components/new-conversation-button.tsx` exactly.
 */
export function StartAgentChatButton({
  agentKey,
  agentDisplayName,
  variant = 'default',
  size = 'default',
  className,
}: StartAgentChatButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const response = await fetch('/api/bond/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Chat with ${agentDisplayName}` }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      const created = result.data as CreatedConversation;
      router.push(`${ROUTES.agents}/${agentKey}/${created.id}`);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={handleClick}
      disabled={isPending}
    >
      <MessageSquare className="h-4 w-4" />
      {isPending ? 'Starting…' : `Chat with ${agentDisplayName}`}
    </Button>
  );
}
