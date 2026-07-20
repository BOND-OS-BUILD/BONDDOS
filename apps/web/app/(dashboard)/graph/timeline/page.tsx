import Link from 'next/link';

import { Badge, EmptyState, Pagination } from '@bond-os/ui';
import { History } from 'lucide-react';

import { getNodeStyle, nodeHref } from '@/features/graph/lib/node-style';
import { getOrganizationTimelineService } from '@/features/graph/services/graph.service';
import { requireActiveOrganizationId } from '@/lib/organization';

export default async function GraphTimelinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const organizationId = await requireActiveOrganizationId();
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const pageSize = 20;

  const result = await getOrganizationTimelineService(organizationId, { page, pageSize });

  const makeHref = (page: number) => `/graph/timeline?page=${page}`;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Timeline</h1>
        <p className="text-sm text-muted-foreground">Every entity&apos;s activity, in one chronological feed.</p>
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={History}
          title="No activity yet"
          description="Activity appears automatically as documents are processed and entities are created or linked."
        />
      ) : (
        <div className="space-y-4">
          <div className="space-y-3">
            {result.items.map((item) => {
              const style = getNodeStyle(item.entity.entityType);
              const Icon = style.icon;
              const href = nodeHref(item.entity.entityType, item.entity.id);

              return (
                <div key={item.id} className="flex items-start gap-3 rounded-md border border-border p-3">
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: `${style.color}26` }}
                  >
                    <Icon className="h-4 w-4" style={{ color: style.color }} />
                  </span>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      {href ? (
                        <Link href={href} className="text-sm font-medium underline-offset-4 hover:underline">
                          {item.entity.title}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium">{item.entity.title}</span>
                      )}
                      <Badge variant="outline">{item.eventType}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{item.description}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                  </span>
                </div>
              );
            })}
          </div>
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
        </div>
      )}
    </div>
  );
}
