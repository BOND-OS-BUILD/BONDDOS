'use client';

import { useRouter } from 'next/navigation';

import { Button, ConfirmDialog, toast } from '@bond-os/ui';

export function MeetingDeleteButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();

  async function handleDelete() {
    const response = await fetch(`/api/meetings/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Meeting deleted.');
    router.push('/meetings');
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
      description="This permanently deletes the meeting and its attendee list. This can't be undone."
      onConfirm={handleDelete}
    />
  );
}
