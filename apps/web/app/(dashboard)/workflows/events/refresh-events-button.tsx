'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@bond-os/ui';
import { RefreshCw } from 'lucide-react';

/**
 * Re-runs this Server Component page with fresh data via `router.refresh()`
 * — no client-side fetch of its own, unlike `DelegationGraph`'s
 * fetch-on-mount pattern. This page has no live stream (see the caveat on
 * the page itself); this is the "pull the latest" affordance for that gap.
 */
export function RefreshEventsButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw className={`mr-2 h-4 w-4 ${isPending ? 'animate-spin' : ''}`} />
      {isPending ? 'Refreshing…' : 'Refresh'}
    </Button>
  );
}
