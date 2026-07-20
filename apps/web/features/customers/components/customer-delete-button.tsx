'use client';

import { useRouter } from 'next/navigation';

import { Button, ConfirmDialog, toast } from '@bond-os/ui';

export function CustomerDeleteButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();

  async function handleDelete() {
    const response = await fetch(`/api/customers/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Customer deleted.');
    router.push('/customers');
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
      description="This permanently deletes the customer and its logged emails. This can't be undone."
      onConfirm={handleDelete}
    />
  );
}
