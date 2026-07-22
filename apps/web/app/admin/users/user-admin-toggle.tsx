'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, toast } from '@bond-os/ui';

export function UserAdminToggle({ userId, isPlatformAdmin }: { userId: string; isPlatformAdmin: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isPlatformAdmin: !isPlatformAdmin }),
      });
      const json = (await response.json()) as { success: boolean; error?: { message?: string } };
      if (!json.success) throw new Error(json.error?.message ?? 'Update failed.');
      toast.success(isPlatformAdmin ? 'Revoked platform admin.' : 'Granted platform admin.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant={isPlatformAdmin ? 'outline' : 'default'} onClick={toggle} disabled={busy}>
      {isPlatformAdmin ? 'Revoke' : 'Grant'}
    </Button>
  );
}
