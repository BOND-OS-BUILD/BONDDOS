import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '../lib/utils';
import { buttonVariants } from './button';

export interface PaginationProps {
  page: number;
  totalPages: number;
  /** Builds the href for a given page number, e.g. `(p) => \`/projects?page=${p}\`` */
  makeHref: (page: number) => string;
  className?: string;
}

/**
 * URL-driven pagination — renders links (not buttons/state), so it works
 * with Server Component list pages that read `?page=` and needs no client
 * JS. Callers build hrefs that preserve any other active query params
 * (search, sort, filters).
 */
function Pagination({ page, totalPages, makeHref, className }: PaginationProps) {
  if (totalPages <= 1) return null;

  const prevDisabled = page <= 1;
  const nextDisabled = page >= totalPages;

  return (
    <nav className={cn('flex items-center justify-between gap-4', className)} aria-label="Pagination">
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-2">
        <PaginationLink href={makeHref(page - 1)} disabled={prevDisabled} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </PaginationLink>
        <PaginationLink href={makeHref(page + 1)} disabled={nextDisabled} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </PaginationLink>
      </div>
    </nav>
  );
}

function PaginationLink({
  href,
  disabled,
  children,
  ...props
}: React.ComponentPropsWithoutRef<'a'> & { href: string; disabled?: boolean }) {
  const classes = cn(buttonVariants({ variant: 'outline', size: 'icon' }));

  if (disabled) {
    return (
      <span className={cn(classes, 'pointer-events-none opacity-50')} aria-disabled="true">
        {children}
      </span>
    );
  }

  return (
    <Link href={href} className={classes} {...props}>
      {children}
    </Link>
  );
}

export { Pagination };
