'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { ROUTES } from '@bond-os/shared';
import {
  Button,
  type ButtonProps,
  Input,
  Label,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@bond-os/ui';

import type { AvailableAgent } from '../services/agent-discovery.service';

export interface NewGoalButtonProps {
  agents: AvailableAgent[];
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  label?: string;
  className?: string;
}

interface CreatedGoal {
  id: string;
}

/**
 * Opens a minimal dialog to start a new long-running Goal for an agent
 * (Phase 7 spec: Plan -> Observe -> Suggest -> Wait -> Continue. Goals
 * persist. No automatic execution). Unlike `NewConversationButton`, this
 * needs to collect an `agentKey` + `title` first, so it wraps the same
 * self-contained-button shape around a `Modal` form instead of posting
 * immediately.
 */
export function NewGoalButton({
  agents,
  variant = 'default',
  size = 'default',
  label = 'New goal',
  className,
}: NewGoalButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [agentKey, setAgentKey] = useState(agents[0]?.agentKey ?? '');
  const [title, setTitle] = useState('');

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!agentKey || !trimmedTitle) return;

    setIsPending(true);
    try {
      const response = await fetch('/api/agents/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ agentKey, title: trimmedTitle }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      const created = result.data as CreatedGoal;
      setOpen(false);
      setTitle('');
      router.push(`${ROUTES.agentGoals}/${created.id}`);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <ModalTrigger asChild>
        <Button type="button" variant={variant} size={size} className={className}>
          <Plus className="mr-2 h-4 w-4" />
          {label}
        </Button>
      </ModalTrigger>
      <ModalContent className="sm:max-w-md">
        <ModalHeader>
          <ModalTitle>New goal</ModalTitle>
          <ModalDescription>
            Give an agent a long-running goal. It will plan, observe, and suggest next steps, then wait for you
            before continuing — nothing runs automatically.
          </ModalDescription>
        </ModalHeader>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          <div className="space-y-2">
            <Label htmlFor="new-goal-agent">Agent</Label>
            <Select value={agentKey} onValueChange={setAgentKey}>
              <SelectTrigger id="new-goal-agent">
                <SelectValue placeholder="Choose an agent" />
              </SelectTrigger>
              <SelectContent>
                {agents.map((agent) => (
                  <SelectItem key={agent.agentKey} value={agent.agentKey}>
                    {agent.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-goal-title">Title</Label>
            <Input
              id="new-goal-title"
              placeholder="What should the agent work toward?"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={300}
            />
          </div>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !agentKey || !title.trim()}>
              {isPending ? 'Creating…' : 'Create goal'}
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}
