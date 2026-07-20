'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, toast } from '@bond-os/ui';

export function NotificationActions({ id, read }: { id: string; read: boolean }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<'read' | 'archive' | null>(null);

  async function runAction(action: 'read' | 'archive') {
    setPendingAction(action);
    try {
      const response = await fetch(`/api/notifications/${id}/${action}`, { method: 'POST' });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      router.refresh();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingAction(null);
    }
  }

  const isPending = pendingAction !== null;

  return (
    <div className="flex items-center gap-2">
      {!read && (
        <Button variant="ghost" size="sm" onClick={() => runAction('read')} disabled={isPending}>
          {pendingAction === 'read' ? 'Marking…' : 'Mark read'}
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={() => runAction('archive')} disabled={isPending}>
        {pendingAction === 'archive' ? 'Archiving…' : 'Archive'}
      </Button>
    </div>
  );
}
