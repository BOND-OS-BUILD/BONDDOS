import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bond-os/ui';

import { AdminHeader, AdminPager, parsePage, statusVariant, TableCard } from '@/features/admin/components/admin-ui';
import { listAdminToolExecutions } from '@/features/admin/services/admin.service';

export const dynamic = 'force-dynamic';

export default async function AdminToolExecutionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);
  const result = await listAdminToolExecutions({ page });
  return (
    <div className="space-y-4">
      <AdminHeader title="Tool Executions" description={`${result.total} execution${result.total === 1 ? '' : 's'} across all organizations.`} />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Status</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.map((execution) => (
              <TableRow key={execution.id}>
                <TableCell>
                  <Badge variant={statusVariant(execution.status)}>{execution.status}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{execution.organizationId}</TableCell>
                <TableCell className="text-muted-foreground">
                  {execution.duration !== null ? `${execution.duration} ms` : '—'}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {execution.startedAt ? execution.startedAt.toLocaleString() : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <AdminPager page={result.page} totalPages={result.totalPages} basePath="/admin/tool-executions" />
    </div>
  );
}
