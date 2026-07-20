'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, toast } from '@bond-os/ui';

export function UnlinkButton({ url }: { url: string }) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const response = await fetch(url, { method: 'DELETE' });
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
    <Button variant="ghost" size="sm" onClick={handleClick} disabled={isPending}>
      {isPending ? 'Removing…' : 'Remove'}
    </Button>
  );
}
