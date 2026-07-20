import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { activityFeedQuerySchema, ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Pagination,
  SearchInput,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bond-os/ui';
import { Activity } from 'lucide-react';

import { listActivityFeedService } from '@/features/activity/services/activity.service';
import { getActiveOrganization } from '@/lib/organization';

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Organization Activity Feed (Phase 9) — a read view over the Event Bus. See docs/activity-feed.md. */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  if (!roleSatisfies(active.role, ROLES.MEMBER)) {
    return <EmptyState icon={Activity} title="Activity Feed" description="Organization members can view activity." />;
  }

  const query = activityFeedQuerySchema.parse(await searchParams);
  const result = await listActivityFeedService(active.id, query);

  const hasFilters = Boolean(query.eventType);
  const makeHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.eventType) params.set('eventType', query.eventType);
    params.set('page', String(page));
    return `${ROUTES.activity}?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity Feed</h1>
        <p className="text-sm text-muted-foreground">
          What&apos;s happened across your organization — projects, tasks, meetings, documents, comments, and more.
        </p>
      </div>

      <SearchInput paramName="eventType" placeholder="Event type (exact), e.g. task.completed" className="max-w-xs" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <EmptyState
              icon={Activity}
              title={hasFilters ? 'No events match your filter' : 'No activity yet'}
              description={
                hasFilters
                  ? 'Try a different event type, or clear the filter.'
                  : 'Activity from projects, tasks, meetings, documents, and comments will appear here.'
              }
            />
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">{event.eventType}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{event.source}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {event.entityType ? `${event.entityType}` : '—'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDateTime(event.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
