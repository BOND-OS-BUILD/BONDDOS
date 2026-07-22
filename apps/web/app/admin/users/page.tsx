import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bond-os/ui';

import { AdminHeader, AdminPager, parsePage, TableCard } from '@/features/admin/components/admin-ui';
import { listAdminUsers } from '@/features/admin/services/admin.service';

import { UserAdminToggle } from './user-admin-toggle';

export const dynamic = 'force-dynamic';

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);
  const { users, stats } = await listAdminUsers({ page });
  return (
    <div className="space-y-4">
      <AdminHeader
        title="Users"
        description={`${stats.total} users · ${stats.active} active · ${stats.platformAdmins} platform admin${stats.platformAdmins === 1 ? '' : 's'}`}
      />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Orgs</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="text-right">Platform admin</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.items.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="font-medium">{user.name}</div>
                  <div className="text-xs text-muted-foreground">{user.email}</div>
                </TableCell>
                <TableCell>{user.organizationCount}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{user.status}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{user.createdAt.toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    {user.isPlatformAdmin ? <Badge variant="success">Admin</Badge> : null}
                    <UserAdminToggle userId={user.id} isPlatformAdmin={user.isPlatformAdmin} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <AdminPager page={users.page} totalPages={users.totalPages} basePath="/admin/users" />
    </div>
  );
}
