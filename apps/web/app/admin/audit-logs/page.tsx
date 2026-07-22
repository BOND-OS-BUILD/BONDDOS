import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bond-os/ui';

import { AdminHeader, AdminPager, parsePage, TableCard } from '@/features/admin/components/admin-ui';
import { listAdminAuditEvents } from '@/features/admin/services/admin.service';

export const dynamic = 'force-dynamic';

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);
  const result = await listAdminAuditEvents({ page });
  return (
    <div className="space-y-4">
      <AdminHeader title="Audit Logs" description={`${result.total} audit event${result.total === 1 ? '' : 's'}.`} />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Action</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="font-medium">{event.action}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{event.organizationId}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{event.userId ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{event.createdAt.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <AdminPager page={result.page} totalPages={result.totalPages} basePath="/admin/audit-logs" />
    </div>
  );
}
