import { Skeleton } from '@bond-os/ui';

export default function SyncLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={`sync-skeleton-row-${index}`} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
