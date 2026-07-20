'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, toast } from '@bond-os/ui';

export function EmbeddingAdminActions() {
  const router = useRouter();
  const [isRetrying, setIsRetrying] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);

  async function handleRetry() {
    setIsRetrying(true);
    try {
      const response = await fetch('/api/embeddings/jobs/retry', { method: 'POST' });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success('Failed embedding jobs queued for retry.');
      router.refresh();
    } finally {
      setIsRetrying(false);
    }
  }

  async function handleRebuild() {
    if (!window.confirm('This deletes and regenerates every embedding in your organization. Continue?')) {
      return;
    }
    setIsRebuilding(true);
    try {
      const response = await fetch('/api/embeddings/rebuild', { method: 'POST' });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success('Vector rebuild started.');
      router.refresh();
    } finally {
      setIsRebuilding(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={handleRetry} disabled={isRetrying}>
        {isRetrying ? 'Retrying…' : 'Retry Failed Jobs'}
      </Button>
      <Button size="sm" variant="outline" onClick={handleRebuild} disabled={isRebuilding}>
        {isRebuilding ? 'Rebuilding…' : 'Rebuild All Vectors'}
      </Button>
    </div>
  );
}
