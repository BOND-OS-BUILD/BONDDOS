import { getOrganizationMembers } from '@bond-os/database';
import { Avatar, AvatarFallback, Badge, Card, CardContent, CardHeader, CardTitle, Separator } from '@bond-os/ui';
import { CalendarDays, FileText, Users, Video } from 'lucide-react';
import Link from 'next/link';

import { PriorityBadge } from '@/features/shared/components/priority-badge';
import { ProjectDeleteButton } from '@/features/projects/components/project-delete-button';
import { ProjectFormDialog } from '@/features/projects/components/project-form-dialog';
import { getProjectService } from '@/features/projects/services/project.service';
import { requireActiveOrganizationId } from '@/lib/organization';

const STATUS_LABEL: Record<string, string> = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

const TASK_STATUS_LABEL: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const [project, members] = await Promise.all([
    getProjectService(organizationId, id),
    getOrganizationMembers(organizationId),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
            <Badge variant="outline">{STATUS_LABEL[project.status] ?? project.status}</Badge>
            <PriorityBadge priority={project.priority} />
          </div>
          {project.description ? <p className="max-w-2xl text-sm text-muted-foreground">{project.description}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <ProjectFormDialog project={project} members={members} trigger={<button className="text-sm font-medium underline underline-offset-4">Edit</button>} />
          <ProjectDeleteButton id={project.id} title={project.title} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <p className="text-muted-foreground">Owner</p>
          <p className="font-medium">{project.owner?.name ?? 'Unassigned'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Start date</p>
          <p className="font-medium">{project.startDate ? new Date(project.startDate).toLocaleDateString() : '—'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Due date</p>
          <p className="font-medium">{project.dueDate ? new Date(project.dueDate).toLocaleDateString() : '—'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Members</p>
          <p className="font-medium">{project.members.length}</p>
        </div>
      </div>

      <Separator />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4" /> Tasks ({project.tasks.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {project.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet.</p>
            ) : (
              project.tasks.map((task) => (
                <div key={task.id} className="flex items-center justify-between rounded-md border border-border p-2 text-sm">
                  <span>{task.title}</span>
                  <div className="flex items-center gap-2">
                    <PriorityBadge priority={task.priority} />
                    <Badge variant="outline">{TASK_STATUS_LABEL[task.status] ?? task.status}</Badge>
                  </div>
                </div>
              ))
            )}
            <Link href={`/tasks?projectId=${project.id}`} className="inline-block text-sm font-medium underline underline-offset-4">
              View all tasks
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Documents ({project.documents.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {project.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents yet.</p>
            ) : (
              project.documents.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/documents/${doc.id}`}
                  className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-accent"
                >
                  <span>{doc.title}</span>
                  <Badge variant="outline">{doc.type}</Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Video className="h-4 w-4" /> Meetings ({project.meetings.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {project.meetings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No meetings yet.</p>
            ) : (
              project.meetings.map((meeting) => (
                <Link
                  key={meeting.id}
                  href={`/meetings/${meeting.id}`}
                  className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-accent"
                >
                  <span>{meeting.title}</span>
                  <span className="text-muted-foreground">{new Date(meeting.meetingDate).toLocaleDateString()}</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Members ({project.members.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {project.members.length === 0 ? (
              <p className="text-sm text-muted-foreground">No members yet.</p>
            ) : (
              project.members.map((member) => (
                <div key={member.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs">{member.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span>{member.name}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
