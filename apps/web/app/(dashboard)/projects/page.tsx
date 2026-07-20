import { getOrganizationMembers } from '@bond-os/database';
import { PROJECT_STATUSES, projectQuerySchema } from '@bond-os/shared';
import { Button, EmptyState, Pagination, SearchInput } from '@bond-os/ui';
import { FolderKanban, Plus } from 'lucide-react';

import { ProjectFormDialog } from '@/features/projects/components/project-form-dialog';
import { ProjectsTable } from '@/features/projects/components/projects-table';
import { listProjectsService } from '@/features/projects/services/project.service';
import { QuerySelectFilter } from '@/features/shared/components/query-select-filter';
import { requireActiveOrganizationId } from '@/lib/organization';

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const organizationId = await requireActiveOrganizationId();
  const query = projectQuerySchema.parse(await searchParams);

  const [result, members] = await Promise.all([
    listProjectsService(organizationId, query),
    getOrganizationMembers(organizationId),
  ]);

  const makeHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.status) params.set('status', query.status);
    params.set('page', String(page));
    return `/projects?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted-foreground">Track initiatives across your organization.</p>
        </div>
        <ProjectFormDialog
          members={members}
          trigger={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New project
            </Button>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search projects…" className="max-w-xs" />
        <QuerySelectFilter
          paramName="status"
          placeholder="Status"
          options={PROJECT_STATUSES.map((status) => ({ value: status, label: status.replace('_', ' ') }))}
        />
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={query.search || query.status ? 'No projects match your filters' : 'No projects yet'}
          description={
            query.search || query.status
              ? 'Try a different search term or clear the filters.'
              : 'Create your first project to start tracking work.'
          }
          action={
            !query.search && !query.status ? (
              <ProjectFormDialog members={members} trigger={<Button variant="outline">New project</Button>} />
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <ProjectsTable projects={result.items} />
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
        </div>
      )}
    </div>
  );
}
