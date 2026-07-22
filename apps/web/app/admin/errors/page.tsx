import { errorGroupQuerySchema } from '@bond-os/shared';
import { Badge, StatCard, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bond-os/ui';
import { AlertTriangle, Bug, ListChecks } from 'lucide-react';

import { AdminHeader, AdminPager, parsePage, TableCard } from '@/features/admin/components/admin-ui';
import { listErrorGroupsService } from '@/features/errors/services/error-reporting.service';

import { ErrorResolveButton } from './error-resolve-button';

export const dynamic = 'force-dynamic';

export default async function AdminErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);
  const query = errorGroupQuerySchema.parse({ page });
  const { groups, stats } = await listErrorGroupsService(query);
  return (
    <div className="space-y-4">
      <AdminHeader title="Errors" description="Grouped application errors (server and client)." />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Error groups" value={stats.totalGroups} icon={Bug} />
        <StatCard label="Unresolved" value={stats.unresolved} icon={AlertTriangle} />
        <StatCard label="Occurrences (24h)" value={stats.eventsInWindow} icon={ListChecks} />
      </div>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Error</TableHead>
              <TableHead>Count</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.items.map((group) => (
              <TableRow key={group.id}>
                <TableCell className="max-w-md">
                  <div className="truncate font-medium">{group.message}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {group.lastRoute ?? ''}
                    {group.lastStatusCode ? ` · ${group.lastStatusCode}` : ''}
                  </div>
                </TableCell>
                <TableCell>{group.count}</TableCell>
                <TableCell className="text-muted-foreground">{group.lastSeenAt.toLocaleString()}</TableCell>
                <TableCell>
                  {group.resolved ? <Badge variant="success">Resolved</Badge> : <Badge variant="destructive">Open</Badge>}
                </TableCell>
                <TableCell className="text-right">
                  <ErrorResolveButton id={group.id} resolved={group.resolved} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <AdminPager page={groups.page} totalPages={groups.totalPages} basePath="/admin/errors" />
    </div>
  );
}
