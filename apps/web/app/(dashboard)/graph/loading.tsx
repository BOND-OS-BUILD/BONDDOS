import { Skeleton } from '@bond-os/ui';

export default function GraphLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={`graph-stat-skeleton-${index}`} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-[600px] w-full" />
    </div>
  );
}
