import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { EventSource, listEvents } from '@bond-os/database';
import { ROLES, ROUTES, roleSatisfies, workflowEventListQuerySchema } from '@bond-os/shared';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
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
import { Radio } from 'lucide-react';

import { QuerySelectFilter } from '@/features/shared/components/query-select-filter';
import { getActiveOrganization } from '@/lib/organization';

import { RefreshEventsButton } from './refresh-events-button';

const EVENT_SOURCE_VALUES = Object.values(EventSource);

/** Truncates a UUID-ish id to `xxxxxxxx…xxxx` for a compact monospace cell; the full value is always in the `title` attribute. */
function truncateId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function WorkflowEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const canView = roleSatisfies(active.role, ROLES.MEMBER);

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Event Monitor</CardTitle>
          <CardDescription>Organization members can view the Event Bus.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const query = workflowEventListQuerySchema.parse(await searchParams);

  // Matches the API route's own cast (`source as EventSource | undefined`) — the
  // Select below only ever submits a valid EventSource, so this is exercised the
  // same way a hand-edited URL would exercise the route.
  const result = await listEvents({
    organizationId: active.id,
    ...query,
    source: query.source as EventSource | undefined,
  });

  const hasFilters = Boolean(query.eventType || query.source);

  const makeHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.eventType) params.set('eventType', query.eventType);
    if (query.source) params.set('source', query.source);
    params.set('page', String(page));
    return `${ROUTES.workflowEvents}?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Event Monitor</h1>
          <p className="text-sm text-muted-foreground">
            Everything published to the Event Bus — where it came from and which workflows it was eligible to
            trigger.
          </p>
        </div>
        <RefreshEventsButton />
      </div>

      <p className="rounded-md border border-dashed border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        This is a snapshot as of your last page load — events don&apos;t stream in live yet; use Refresh to pull the
        latest. Individual events also don&apos;t carry their own processing outcome or a direct link to the
        workflow run they triggered — match the Correlation ID below against a Workflow Run with the same id to
        trace one.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <QuerySelectFilter
          paramName="source"
          placeholder="Source"
          options={EVENT_SOURCE_VALUES.map((source) => ({ value: source, label: source }))}
        />
        <SearchInput paramName="eventType" placeholder="Event type (exact), e.g. document.uploaded" className="max-w-xs" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <EmptyState
              icon={Radio}
              title={hasFilters ? 'No events match your filters' : 'No events yet'}
              description={
                hasFilters
                  ? 'Try a different source or event type, or clear the filters.'
                  : 'Events published by documents, projects, tasks, and other activity will appear here as they happen.'
              }
            />
          ) : (
            <div className="space-y-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Correlation ID</TableHead>
                    <TableHead>Created At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="font-medium">{event.eventType}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{event.source}</Badge>
                      </TableCell>
                      <TableCell
                        className="font-mono text-xs text-muted-foreground"
                        title={event.correlationId}
                      >
                        {truncateId(event.correlationId)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(event.createdAt)}
                      </TableCell>
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
