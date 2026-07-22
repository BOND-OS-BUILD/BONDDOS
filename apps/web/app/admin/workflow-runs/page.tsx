import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bond-os/ui';

import { AdminHeader, AdminPager, parsePage, statusVariant, TableCard } from '@/features/admin/components/admin-ui';
import { listAdminWorkflowRuns } from '@/features/admin/services/admin.service';

export const dynamic = 'force-dynamic';

export default async function AdminWorkflowRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);
  const result = await listAdminWorkflowRuns({ page });
  return (
    <div className="space-y-4">
      <AdminHeader title="Workflow Runs" description={`${result.total} run${result.total === 1 ? '' : 's'} across all organizations.`} />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Completed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.map((run) => (
              <TableRow key={run.id}>
                <TableCell>
                  <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{run.organizationId}</TableCell>
                <TableCell className="text-muted-foreground">{run.startedAt.toLocaleString()}</TableCell>
                <TableCell className="text-muted-foreground">{run.completedAt ? run.completedAt.toLocaleString() : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <AdminPager page={result.page} totalPages={result.totalPages} basePath="/admin/workflow-runs" />
    </div>
  );
}
