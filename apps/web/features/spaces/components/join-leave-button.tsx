'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, toast } from '@bond-os/ui';

export function JoinLeaveButton({ spaceId, isMember, userId }: { spaceId: string; isMember: boolean; userId: string }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const response = await fetch(
        isMember ? `/api/spaces/${spaceId}/members/${userId}` : `/api/spaces/${spaceId}/members`,
        { method: isMember ? 'DELETE' : 'POST' },
      );
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      router.refresh();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button variant={isMember ? 'outline' : 'default'} size="sm" onClick={handleClick} disabled={isPending}>
      {isPending ? '…' : isMember ? 'Leave space' : 'Join space'}
    </Button>
  );
}
