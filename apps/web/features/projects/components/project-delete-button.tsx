'use client';

import { useRouter } from 'next/navigation';

import { Button, ConfirmDialog, toast } from '@bond-os/ui';

export function ProjectDeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();

  async function handleDelete() {
    const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Project deleted.');
    router.push('/projects');
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
      description="This permanently deletes the project and everything attached to it (tasks, documents, meetings). This can't be undone."
      onConfirm={handleDelete}
    />
  );
}
