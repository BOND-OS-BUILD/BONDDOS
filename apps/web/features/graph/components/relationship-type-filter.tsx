'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { RELATIONSHIP_TYPES } from '@bond-os/shared';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@bond-os/ui';

export interface RelationshipTypeFilterProps {
  value?: string;
}

/** Drives the `?relationshipType=` URL param on the Relationship Explorer table, resetting `page` to 1 on change. */
export function RelationshipTypeFilter({ value }: RelationshipTypeFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'ALL') {
      params.delete('relationshipType');
    } else {
      params.set('relationshipType', next);
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Select value={value ?? 'ALL'} onValueChange={handleChange}>
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="All types" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">All types</SelectItem>
        {RELATIONSHIP_TYPES.map((type) => (
          <SelectItem key={type} value={type}>
            {type}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
