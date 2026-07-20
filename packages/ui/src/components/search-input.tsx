'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

import { cn } from '../lib/utils';
import { Input } from './input';

export interface SearchInputProps {
  placeholder?: string;
  /** Query string key to read/write. */
  paramName?: string;
  /** Debounce delay, in ms, before the URL updates. */
  debounceMs?: number;
  className?: string;
}

/**
 * Debounced search box that drives a `?search=` (or custom) URL param —
 * list pages are Server Components that read it directly, so no client-side
 * data fetching is needed here, just navigation.
 */
function SearchInput({ placeholder = 'Search…', paramName = 'search', debounceMs = 300, className }: SearchInputProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = React.useState(searchParams.get(paramName) ?? '');

  React.useEffect(() => {
    setValue(searchParams.get(paramName) ?? '');
  }, [searchParams, paramName]);

  React.useEffect(() => {
    const current = searchParams.get(paramName) ?? '';
    if (value === current) return;

    const handle = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(paramName, value);
      } else {
        params.delete(paramName);
      }
      params.delete('page');
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, debounceMs);

    return () => clearTimeout(handle);
    // Intentionally excludes `searchParams`/`router` from deps — including them
    // would re-run this effect (and re-debounce) on every navigation.
  }, [value, debounceMs, paramName, pathname]);

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        className="pl-9 pr-9"
      />
      {value ? (
        <button
          type="button"
          onClick={() => setValue('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

export { SearchInput };
