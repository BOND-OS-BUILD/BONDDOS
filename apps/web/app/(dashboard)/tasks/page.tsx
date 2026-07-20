import { getOrganizationMembers } from '@bond-os/database';
import { TASK_STATUSES, taskQuerySchema } from '@bond-os/shared';
import { Button, EmptyState, Pagination, SearchInput } from '@bond-os/ui';
import { ListTodo, Plus } from 'lucide-react';

import { listDocumentsService } from '@/features/documents/services/document.service';
import { listProjectsService } from '@/features/projects/services/project.service';
import { QuerySelectFilter } from '@/features/shared/components/query-select-filter';
import { TaskFormDialog } from '@/features/tasks/components/task-form-dialog';
import { TasksTable } from '@/features/tasks/components/tasks-table';
import { listTasksService } from '@/features/tasks/services/task.service';
import { requireActiveOrganizationId } from '@/lib/organization';

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const organizationId = await requireActiveOrganizationId();
  const query = taskQuerySchema.parse(await searchParams);

  const [result, members, projectsResult, documentsResult] = await Promise.all([
    listTasksService(organizationId, query),
    getOrganizationMembers(organizationId),
    listProjectsService(organizationId, { page: 1, pageSize: 200, sortBy: 'title', sortDir: 'asc' }),
    listDocumentsService(organizationId, { page: 1, pageSize: 200, sortBy: 'title', sortDir: 'asc' }),
  ]);

  const projects = projectsResult.items.map((project) => ({ id: project.id, title: project.title }));
  const documents = documentsResult.items.map((document) => ({ id: document.id, title: document.title }));

  const hasFilters = Boolean(query.search || query.status || query.projectId);

  const makeHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.status) params.set('status', query.status);
    if (query.projectId) params.set('projectId', query.projectId);
    params.set('page', String(page));
    return `/tasks?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-sm text-muted-foreground">Track work items across your projects.</p>
        </div>
        <TaskFormDialog
          projects={projects}
          members={members}
          documents={documents}
          trigger={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New task
            </Button>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search tasks…" className="max-w-xs" />
        <QuerySelectFilter
          paramName="status"
          placeholder="Status"
          options={TASK_STATUSES.map((status) => ({ value: status, label: status.replace('_', ' ') }))}
        />
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title={hasFilters ? 'No tasks match your filters' : 'No tasks yet'}
          description={
            hasFilters
              ? 'Try a different search term or clear the filters.'
              : 'Create your first task to start tracking work.'
          }
          action={
            !hasFilters ? (
              <TaskFormDialog
                projects={projects}
                members={members}
                documents={documents}
                trigger={<Button variant="outline">New task</Button>}
              />
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <TasksTable tasks={result.items} projects={projects} members={members} documents={documents} />
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
        </div>
      )}
    </div>
  );
}
