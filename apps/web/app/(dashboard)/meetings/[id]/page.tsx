import { getOrganizationMembers } from '@bond-os/database';
import { Avatar, AvatarFallback, Badge, Card, CardContent, CardHeader, CardTitle, Separator } from '@bond-os/ui';
import { FileText, Users } from 'lucide-react';
import Link from 'next/link';

import { MeetingDeleteButton } from '@/features/meetings/components/meeting-delete-button';
import { MeetingFormDialog } from '@/features/meetings/components/meeting-form-dialog';
import { getMeetingService } from '@/features/meetings/services/meeting.service';
import { listProjectsService } from '@/features/projects/services/project.service';
import { requireActiveOrganizationId } from '@/lib/organization';

function formatMeetingDate(date: Date | string): string {
  return new Date(date).toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

function formatDuration(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export default async function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const [meeting, projectsResult, members] = await Promise.all([
    getMeetingService(organizationId, id),
    listProjectsService(organizationId, { page: 1, pageSize: 200, sortBy: 'title', sortDir: 'asc' }),
    getOrganizationMembers(organizationId),
  ]);
  const projects = projectsResult.items;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{meeting.title}</h1>
          <p className="text-sm text-muted-foreground">
            {formatMeetingDate(meeting.meetingDate)}
            {meeting.duration !== null ? ` · ${formatDuration(meeting.duration)}` : ''}
            {meeting.location ? ` · ${meeting.location}` : ''}
          </p>
          <Link href={`/projects/${meeting.project.id}`} className="inline-block text-sm font-medium underline underline-offset-4">
            {meeting.project.title}
          </Link>
        </div>
        <div className="flex shrink-0 gap-2">
          <MeetingFormDialog
            meeting={meeting}
            projects={projects}
            members={members}
            trigger={<button className="text-sm font-medium underline underline-offset-4">Edit</button>}
          />
          <MeetingDeleteButton id={meeting.id} title={meeting.title} />
        </div>
      </div>

      {meeting.agenda ? (
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-muted-foreground">Agenda</h2>
          <p className="whitespace-pre-wrap text-sm">{meeting.agenda}</p>
        </div>
      ) : null}

      {meeting.notes ? (
        <div className="space-y-1">
          <h2 className="text-sm font-medium text-muted-foreground">Notes</h2>
          <p className="whitespace-pre-wrap text-sm">{meeting.notes}</p>
        </div>
      ) : null}

      <Separator />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Attendees ({meeting.attendees.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {meeting.attendees.length === 0 ? (
              <p className="text-sm text-muted-foreground">No attendees yet.</p>
            ) : (
              meeting.attendees.map((attendee) => (
                <div key={attendee.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs">{attendee.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span>{attendee.name}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> Documents ({meeting.documents.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {meeting.documents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents yet.</p>
            ) : (
              meeting.documents.map((doc) => (
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
      </div>
    </div>
  );
}
