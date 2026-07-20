import { getOrganizationMembers } from '@bond-os/database';
import { meetingQuerySchema } from '@bond-os/shared';
import { Button, EmptyState, Pagination, SearchInput } from '@bond-os/ui';
import { Plus, Video } from 'lucide-react';

import { listProjectsService } from '@/features/projects/services/project.service';
import { MeetingFormDialog } from '@/features/meetings/components/meeting-form-dialog';
import { MeetingsTable } from '@/features/meetings/components/meetings-table';
import { listMeetingsService } from '@/features/meetings/services/meeting.service';
import { QuerySelectFilter } from '@/features/shared/components/query-select-filter';
import { requireActiveOrganizationId } from '@/lib/organization';

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const organizationId = await requireActiveOrganizationId();
  const query = meetingQuerySchema.parse(await searchParams);

  const [result, projectsResult, members] = await Promise.all([
    listMeetingsService(organizationId, query),
    listProjectsService(organizationId, {
      page: 1,
      pageSize: 200,
      sortBy: 'title',
      sortDir: 'asc',
    }),
    getOrganizationMembers(organizationId),
  ]);
  const projects = projectsResult.items;

  const makeHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.projectId) params.set('projectId', query.projectId);
    params.set('page', String(page));
    return `/meetings?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
          <p className="text-sm text-muted-foreground">Track meetings and who attended them.</p>
        </div>
        <MeetingFormDialog
          projects={projects}
          members={members}
          trigger={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              New meeting
            </Button>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search meetings…" className="max-w-xs" />
        <QuerySelectFilter
          paramName="projectId"
          placeholder="Project"
          options={projects.map((project) => ({ value: project.id, label: project.title }))}
        />
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={Video}
          title={query.search || query.projectId ? 'No meetings match your filters' : 'No meetings yet'}
          description={
            query.search || query.projectId
              ? 'Try a different search term or clear the filters.'
              : 'Schedule your first meeting to start tracking it.'
          }
          action={
            !query.search && !query.projectId ? (
              <MeetingFormDialog
                projects={projects}
                members={members}
                trigger={<Button variant="outline">New meeting</Button>}
              />
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <MeetingsTable meetings={result.items} />
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
        </div>
      )}
    </div>
  );
}
