'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from '@bond-os/ui';

export interface LinkContentFormProps {
  spaceId: string;
  /** e.g. "projects", "knowledge-documents", "workflows", "agents" — the `/api/spaces/[id]/<resource>` segment. */
  resource: string;
  /** The JSON body field name the POST route expects, e.g. "projectId". */
  fieldName: string;
  options: Array<{ value: string; label: string }>;
  placeholder: string;
  emptyMessage: string;
}

export function LinkContentForm({ spaceId, resource, fieldName, options, placeholder, emptyMessage }: LinkContentFormProps) {
  const router = useRouter();
  const [value, setValue] = useState<string | undefined>(undefined);
  const [isPending, setIsPending] = useState(false);

  async function handleLink() {
    if (!value) return;
    setIsPending(true);
    try {
      const response = await fetch(`/api/spaces/${spaceId}/${resource}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [fieldName]: value }),
      });
      const result = await response.json();
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setValue(undefined);
      router.refresh();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsPending(false);
    }
  }

  if (options.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger className="h-8 w-56 text-xs">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" size="sm" variant="outline" onClick={handleLink} disabled={!value || isPending}>
        {isPending ? 'Linking…' : 'Link'}
      </Button>
    </div>
  );
}
