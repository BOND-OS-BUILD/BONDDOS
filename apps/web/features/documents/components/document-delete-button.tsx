'use client';

import { useRouter } from 'next/navigation';

import { Button, ConfirmDialog, toast } from '@bond-os/ui';

export function DocumentDeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();

  async function handleDelete() {
    const response = await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Document deleted.');
    router.push('/documents');
    router.refresh();
  }

  return (
    <ConfirmDialog
      trigger={
        <Button variant="outline" size="sm">
          Delete
        </Button>
      }
      title={`Delete "${title}"?`}
      description="This permanently deletes the document and its file. This can't be undone."
      onConfirm={handleDelete}
    />
  );
}
