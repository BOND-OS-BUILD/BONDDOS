import { CUSTOMER_STATUSES, customerQuerySchema } from '@bond-os/shared';
import { Button, EmptyState, Pagination, SearchInput } from '@bond-os/ui';
import { Building2, Plus } from 'lucide-react';

import { CustomerFormDialog } from '@/features/customers/components/customer-form-dialog';
import { CustomersTable } from '@/features/customers/components/customers-table';
import { listCustomersService } from '@/features/customers/services/customer.service';
import { listProjectsService } from '@/features/projects/services/project.service';
import { QuerySelectFilter } from '@/features/shared/components/query-select-filter';
import { requireActiveOrganizationId } from '@/lib/organization';

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const organizationId = await requireActiveOrganizationId();
  const query = customerQuerySchema.parse(await searchParams);

  const [result, projectsResult] = await Promise.all([
    listCustomersService(organizationId, query),
    listProjectsService(organizationId, { page: 1, pageSize: 200, sortBy: 'title', sortDir: 'asc' }),
  ]);
  const projects = projectsResult.items.map((project) => ({ id: project.id, title: project.title }));

  const makeHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.status) params.set('status', query.status);
    params.set('page', String(page));
    return `/customers?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground">Track the customers your organization works with.</p>
        </div>
        <CustomerFormDialog
          projects={projects}
          trigger={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New customer
            </Button>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search customers…" className="max-w-xs" />
        <QuerySelectFilter
          paramName="status"
          placeholder="Status"
          options={CUSTOMER_STATUSES.map((status) => ({
            value: status,
            label: status.charAt(0) + status.slice(1).toLowerCase(),
          }))}
        />
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={query.search || query.status ? 'No customers match your filters' : 'No customers yet'}
          description={
            query.search || query.status
              ? 'Try a different search term or clear the filters.'
              : 'Add your first customer to start tracking the relationship.'
          }
          action={
            !query.search && !query.status ? (
              <CustomerFormDialog projects={projects} trigger={<Button variant="outline">New customer</Button>} />
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <CustomersTable customers={result.items} />
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
        </div>
      )}
    </div>
  );
}
