'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, toast } from '@bond-os/ui';

export function ErrorResolveButton({ id, resolved }: { id: string; resolved: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/errors', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, resolved: !resolved }),
      });
      const json = (await response.json()) as { success: boolean; error?: { message?: string } };
      if (!json.success) throw new Error(json.error?.message ?? 'Update failed.');
      toast.success(resolved ? 'Reopened.' : 'Resolved.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={toggle} disabled={busy}>
      {resolved ? 'Reopen' : 'Resolve'}
    </Button>
  );
}
