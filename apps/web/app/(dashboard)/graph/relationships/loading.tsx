import { Skeleton } from '@bond-os/ui';

export default function RelationshipsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <Skeleton className="h-10 w-[220px]" />
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={`relationships-skeleton-row-${index}`} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
