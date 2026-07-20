import { DOCUMENT_TYPES, documentQuerySchema } from '@bond-os/shared';
import { Button, EmptyState, Pagination, SearchInput } from '@bond-os/ui';
import { FileText, Plus } from 'lucide-react';

import { DocumentUploadDialog } from '@/features/documents/components/document-upload-dialog';
import { DocumentsTable } from '@/features/documents/components/documents-table';
import { listDocumentsService } from '@/features/documents/services/document.service';
import { listMeetingsService } from '@/features/meetings/services/meeting.service';
import { listProjectsService } from '@/features/projects/services/project.service';
import { QuerySelectFilter } from '@/features/shared/components/query-select-filter';
import { requireActiveOrganizationId } from '@/lib/organization';

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const organizationId = await requireActiveOrganizationId();
  const query = documentQuerySchema.parse(await searchParams);

  const [result, projectsResult, meetingsResult] = await Promise.all([
    listDocumentsService(organizationId, query),
    listProjectsService(organizationId, { page: 1, pageSize: 200, sortBy: 'title', sortDir: 'asc' }),
    listMeetingsService(organizationId, { page: 1, pageSize: 200, sortBy: 'title', sortDir: 'asc' }),
  ]);
  const projects = projectsResult.items;
  const meetings = meetingsResult.items;

  const makeHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.type) params.set('type', query.type);
    params.set('page', String(page));
    return `/documents?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
          <p className="text-sm text-muted-foreground">Files linked to your projects, meetings, and tasks.</p>
        </div>
        <DocumentUploadDialog
          projects={projects}
          meetings={meetings}
          trigger={
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Upload document
            </Button>
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search documents…" className="max-w-xs" />
        <QuerySelectFilter
          paramName="type"
          placeholder="Type"
          options={DOCUMENT_TYPES.map((type) => ({ value: type, label: type }))}
        />
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title={query.search || query.type ? 'No documents match your filters' : 'No documents yet'}
          description={
            query.search || query.type
              ? 'Try a different search term or clear the filters.'
              : 'Upload your first document to start building your knowledge graph.'
          }
          action={
            !query.search && !query.type ? (
              <DocumentUploadDialog
                projects={projects}
                meetings={meetings}
                trigger={<Button variant="outline">Upload document</Button>}
              />
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <DocumentsTable documents={result.items} />
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
        </div>
      )}
    </div>
  );
}
