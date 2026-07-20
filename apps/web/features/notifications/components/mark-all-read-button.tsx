'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, toast } from '@bond-os/ui';

export function MarkAllReadButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const response = await fetch('/api/notifications/read-all', { method: 'POST' });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success('All notifications marked as read.');
      router.refresh();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending}>
      {isPending ? 'Marking…' : 'Mark all read'}
    </Button>
  );
}
