'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, toast } from '@bond-os/ui';

export interface InsightActionsProps {
  insightId: string;
}

/**
 * Acknowledge/Dismiss controls for an OPEN insight. `status` is the only
 * mutable field on an insight (Phase 7 spec: "Never modify data") — this
 * never edits `title`/`description`/`relatedEntityIds`. See docs/insights.md.
 */
export function InsightActions({ insightId }: InsightActionsProps) {
  const router = useRouter();
  const [pendingStatus, setPendingStatus] = useState<'ACKNOWLEDGED' | 'DISMISSED' | null>(null);

  async function updateStatus(status: 'ACKNOWLEDGED' | 'DISMISSED') {
    setPendingStatus(status);
    try {
      const response = await fetch(`/api/agents/insights/${insightId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      router.refresh();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingStatus(null);
    }
  }

  const isPending = pendingStatus !== null;

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => updateStatus('ACKNOWLEDGED')}
        disabled={isPending}
      >
        {pendingStatus === 'ACKNOWLEDGED' ? 'Acknowledging…' : 'Acknowledge'}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => updateStatus('DISMISSED')} disabled={isPending}>
        {pendingStatus === 'DISMISSED' ? 'Dismissing…' : 'Dismiss'}
      </Button>
    </div>
  );
}
