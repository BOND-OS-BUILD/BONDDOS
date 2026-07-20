'use client';

import { useRouter } from 'next/navigation';

import { ROUTES } from '@bond-os/shared';
import { Button, ConfirmDialog, toast } from '@bond-os/ui';

export function SpaceDeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();

  async function handleDelete() {
    const response = await fetch(`/api/spaces/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Space deleted.');
    router.push(ROUTES.spaces);
    router.refresh();
  }

  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          Delete
        </Button>
      }
      title={`Delete "${name}"?`}
      description="This removes the space and its member roster and content links. Linked projects, documents, workflows, and agents themselves are not deleted."
      onConfirm={handleDelete}
    />
  );
}
