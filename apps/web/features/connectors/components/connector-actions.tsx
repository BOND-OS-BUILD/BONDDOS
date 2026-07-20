'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import type { ConnectorProviderId } from '@bond-os/connectors';
import type { ConnectorSummary } from '@bond-os/database';
import { Button, ConfirmDialog, toast } from '@bond-os/ui';

export interface ConnectorActionsProps {
  provider: ConnectorProviderId;
  displayName: string;
  connector: ConnectorSummary | null;
}

export function ConnectorActions({ provider, displayName, connector }: ConnectorActionsProps) {
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  async function handleConnect() {
    setIsConnecting(true);
    try {
      const response = await fetch('/api/connectors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`${displayName} connected.`);
      router.refresh();
    } finally {
      setIsConnecting(false);
    }
  }

  async function handleSync() {
    if (!connector) return;
    setIsSyncing(true);
    try {
      const response = await fetch(`/api/connectors/${connector.id}/sync`, { method: 'POST' });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      const job = result.data as { status: string; errorMessage: string | null };
      if (job.status === 'SUCCEEDED') {
        toast.success(`${displayName} sync completed.`);
      } else {
        toast.error(job.errorMessage ?? `${displayName} sync did not complete.`);
      }
      router.refresh();
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleDisconnect() {
    if (!connector) return;
    const response = await fetch(`/api/connectors/${connector.id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success(`${displayName} disconnected.`);
    router.refresh();
  }

  if (!connector || connector.status === 'DISCONNECTED') {
    return (
      <Button size="sm" onClick={handleConnect} disabled={isConnecting}>
        {isConnecting ? 'Connecting…' : 'Connect'}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={handleSync} disabled={isSyncing}>
        {isSyncing ? 'Syncing…' : 'Sync now'}
      </Button>
      <ConfirmDialog
        trigger={
          <Button size="sm" variant="ghost">
            Disconnect
          </Button>
        }
        title={`Disconnect ${displayName}?`}
        description="This removes the connector and its sync history. You can reconnect later."
        onConfirm={handleDisconnect}
      />
    </div>
  );
}
