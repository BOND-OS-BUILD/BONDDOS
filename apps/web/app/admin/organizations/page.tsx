import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bond-os/ui';

import { AdminHeader, AdminPager, parsePage, TableCard } from '@/features/admin/components/admin-ui';
import { listAdminOrganizations } from '@/features/admin/services/admin.service';

export const dynamic = 'force-dynamic';

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);
  const result = await listAdminOrganizations({ page });
  return (
    <div className="space-y-4">
      <AdminHeader title="Organizations" description={`${result.total} organization${result.total === 1 ? '' : 's'} across the deployment.`} />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.items.map((org) => (
              <TableRow key={org.id}>
                <TableCell className="font-medium">{org.name}</TableCell>
                <TableCell className="text-muted-foreground">{org.slug}</TableCell>
                <TableCell>{org.memberCount}</TableCell>
                <TableCell className="text-muted-foreground">{org.createdAt.toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <AdminPager page={result.page} totalPages={result.totalPages} basePath="/admin/organizations" />
    </div>
  );
}
