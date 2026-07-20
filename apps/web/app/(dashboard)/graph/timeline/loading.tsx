import { Skeleton } from '@bond-os/ui';

export default function GraphTimelineLoading() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-80" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton key={`timeline-skeleton-row-${index}`} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
