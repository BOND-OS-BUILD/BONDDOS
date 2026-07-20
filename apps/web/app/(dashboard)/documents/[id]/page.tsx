import { Badge, Card, CardContent, CardHeader, CardTitle, Separator } from '@bond-os/ui';
import { FolderKanban, ListChecks, Video } from 'lucide-react';
import Link from 'next/link';

import { DocumentDeleteButton } from '@/features/documents/components/document-delete-button';
import { DocumentEditDialog } from '@/features/documents/components/document-edit-dialog';
import { getDocumentService } from '@/features/documents/services/document.service';
import { listMeetingsService } from '@/features/meetings/services/meeting.service';
import { listProjectsService } from '@/features/projects/services/project.service';
import { requireActiveOrganizationId } from '@/lib/organization';

const TASK_STATUS_LABEL: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex] ?? 'TB'}`;
}

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const [document, projectsResult, meetingsResult] = await Promise.all([
    getDocumentService(organizationId, id),
    listProjectsService(organizationId, { page: 1, pageSize: 200, sortBy: 'title', sortDir: 'asc' }),
    listMeetingsService(organizationId, { page: 1, pageSize: 200, sortBy: 'title', sortDir: 'asc' }),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{document.title}</h1>
            <Badge variant="outline">{document.type}</Badge>
          </div>
          {document.description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{document.description}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <DocumentEditDialog
            document={document}
            projects={projectsResult.items}
            meetings={meetingsResult.items}
            trigger={<button className="text-sm font-medium underline underline-offset-4">Edit</button>}
          />
          <DocumentDeleteButton id={document.id} title={document.title} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground">File name</p>
          <p className="font-medium">{document.fileName}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Size</p>
          <p className="font-medium">{formatBytes(document.size)}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Uploaded by</p>
          <p className="font-medium">{document.uploadedBy?.name ?? 'Unknown'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Uploaded</p>
          <p className="font-medium">{new Date(document.createdAt).toLocaleDateString()}</p>
        </div>
      </div>

      <Separator />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderKanban className="h-4 w-4" /> Linked project
            </CardTitle>
          </CardHeader>
          <CardContent>
            {document.project ? (
              <Link href={`/projects/${document.project.id}`} className="text-sm font-medium hover:underline">
                {document.project.title}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">None</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Video className="h-4 w-4" /> Meeting
            </CardTitle>
          </CardHeader>
          <CardContent>
            {document.meeting ? (
              <Link href={`/meetings/${document.meeting.id}`} className="text-sm font-medium hover:underline">
                {document.meeting.title}
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">None</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4" /> Referenced by tasks ({document.tasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {document.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks reference this document.</p>
            ) : (
              document.tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center justify-between rounded-md border border-border p-2 text-sm"
                >
                  <span>{task.title}</span>
                  <Badge variant="outline">{TASK_STATUS_LABEL[task.status] ?? task.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
