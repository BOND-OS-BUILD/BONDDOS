'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

import { ROUTES } from '@bond-os/shared';
import { Button, toast, type ButtonProps } from '@bond-os/ui';

export interface NewConversationButtonProps {
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  label?: string;
  className?: string;
}

interface CreatedConversation {
  id: string;
}

/**
 * Starts a new "Mr. Bond" conversation and navigates to it. Used both as the
 * prominent CTA on the /bond empty state and as the compact "New" affordance
 * atop the conversation-list sidebar (see bond/layout.tsx).
 */
export function NewConversationButton({
  variant = 'default',
  size = 'default',
  label = 'New conversation',
  className,
}: NewConversationButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const response = await fetch('/api/bond/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      const created = result.data as CreatedConversation;
      router.push(`${ROUTES.bond}/${created.id}`);
      router.refresh();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button type="button" variant={variant} size={size} className={className} onClick={handleClick} disabled={isPending}>
      <Plus className="h-4 w-4" />
      {isPending ? 'Creating…' : label}
    </Button>
  );
}
