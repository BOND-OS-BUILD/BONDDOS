'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

import type { GoalStatus } from '@bond-os/database';
import { Button, toast } from '@bond-os/ui';

export interface GoalContinueButtonProps {
  goalId: string;
  status: GoalStatus;
}

/**
 * Runs exactly one more Plan/Observe/Suggest/Wait/Continue step for a goal.
 * This is the only place a goal ever advances (Phase 7 spec: "No automatic
 * execution") — always an explicit click, never a background loop.
 */
export function GoalContinueButton({ goalId, status }: GoalContinueButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const isFinished = status === 'COMPLETED' || status === 'CANCELLED';

  async function handleClick() {
    setIsPending(true);
    try {
      const response = await fetch(`/api/agents/goals/${goalId}/continue`, {
        method: 'POST',
        credentials: 'include',
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      router.refresh();
    } catch {
      toast.error('Failed to continue the goal.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button type="button" onClick={handleClick} disabled={isPending || isFinished}>
      <RefreshCw className="mr-2 h-4 w-4" />
      {isPending ? 'Continuing…' : 'Continue'}
    </Button>
  );
}
