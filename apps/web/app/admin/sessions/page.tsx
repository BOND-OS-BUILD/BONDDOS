import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bond-os/ui';

import { AdminHeader, AdminPager, parsePage, TableCard } from '@/features/admin/components/admin-ui';
import { listAdminSessions } from '@/features/admin/services/admin.service';

export const dynamic = 'force-dynamic';

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);
  const result = await listAdminSessions({ page });
  return (
    <div className="space-y-4">
      <AdminHeader title="Active Sessions" description={`${result.total} unexpired session${result.total === 1 ? '' : 's'}.`} />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>IP address</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Expires</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.map((session) => (
              <TableRow key={session.id}>
                <TableCell>
                  <div className="font-medium">{session.userName}</div>
                  <div className="text-xs text-muted-foreground">{session.userEmail}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{session.ipAddress ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{session.createdAt.toLocaleString()}</TableCell>
                <TableCell className="text-muted-foreground">{session.expiresAt.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <AdminPager page={result.page} totalPages={result.totalPages} basePath="/admin/sessions" />
    </div>
  );
}
