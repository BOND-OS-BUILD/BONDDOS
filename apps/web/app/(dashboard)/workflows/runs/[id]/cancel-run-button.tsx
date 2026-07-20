'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban } from 'lucide-react';

import { Button, toast } from '@bond-os/ui';

export interface CancelRunButtonProps {
  runId: string;
}

/**
 * Cancels a `WorkflowRun` that hasn't reached a terminal status yet —
 * mirrors `GoalContinueButton`'s fetch/toast/`router.refresh()` shape
 * exactly. Always an explicit click; nothing on this page cancels a run on
 * its own.
 */
export function CancelRunButton({ runId }: CancelRunButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const response = await fetch(`/api/workflows/run/${runId}/cancel`, {
        method: 'POST',
        credentials: 'include',
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success('Run cancelled.');
      router.refresh();
    } catch {
      toast.error('Failed to cancel the run.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button type="button" variant="outline" onClick={handleClick} disabled={isPending}>
      <Ban className="mr-2 h-4 w-4" />
      {isPending ? 'Cancelling…' : 'Cancel Run'}
    </Button>
  );
}
