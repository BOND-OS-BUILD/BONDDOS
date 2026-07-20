'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@bond-os/ui';

export interface QuerySelectFilterOption {
  value: string;
  label: string;
}

export interface QuerySelectFilterProps {
  paramName: string;
  placeholder: string;
  options: QuerySelectFilterOption[];
  className?: string;
}

/**
 * A `<Select>` that drives a `?paramName=value` URL param (and resets
 * `page` to 1 on change) — the filter counterpart to `SearchInput`. Shared
 * across every entity list page (status/priority/type filters) instead of
 * each feature re-implementing the same URL-sync logic.
 */
export function QuerySelectFilter({ paramName, placeholder, options, className }: QuerySelectFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const value = searchParams.get(paramName) ?? undefined;

  function handleChange(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'ALL') {
      params.delete(paramName);
    } else {
      params.set(paramName, next);
    }
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <Select value={value ?? 'ALL'} onValueChange={handleChange}>
      <SelectTrigger className={className ?? 'w-[160px]'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="ALL">All {placeholder.toLowerCase()}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
