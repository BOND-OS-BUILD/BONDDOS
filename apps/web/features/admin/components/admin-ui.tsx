import Link from 'next/link';

import { cn } from '@bond-os/ui';

export function AdminHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function AdminPager({
  page,
  totalPages,
  basePath,
}: {
  page: number;
  totalPages: number;
  basePath: string;
}) {
  if (totalPages <= 1) return null;
  const enabled = 'rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent';
  const disabled = 'rounded-md border px-3 py-1.5 text-sm font-medium opacity-50';
  return (
    <div className="flex items-center justify-between gap-2 pt-1">
      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link className={enabled} href={`${basePath}?page=${page - 1}`}>
            Previous
          </Link>
        ) : (
          <span className={disabled}>Previous</span>
        )}
        {page < totalPages ? (
          <Link className={enabled} href={`${basePath}?page=${page + 1}`}>
            Next
          </Link>
        ) : (
          <span className={disabled}>Next</span>
        )}
      </div>
    </div>
  );
}

export type BadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning' | 'outline';

/** Map a health/run/execution status string to a Badge variant. */
export function statusVariant(status: string): BadgeVariant {
  const normalized = status.toUpperCase();
  if (['OK', 'SUCCEEDED', 'COMPLETED', 'ACTIVE', 'APPROVED'].includes(normalized)) return 'success';
  if (['DEGRADED', 'PENDING', 'RUNNING', 'RETRYING', 'WAITING', 'PROCESSING'].includes(normalized)) return 'warning';
  if (['DOWN', 'FAILED', 'ERROR', 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(normalized)) return 'destructive';
  return 'secondary';
}

export function parsePage(value: string | undefined): number {
  const page = Number(value ?? '1');
  return Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
}

export function TableCard({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('overflow-x-auto rounded-lg border bg-card', className)}>{children}</div>;
}
