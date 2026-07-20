'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { MeetingListItem } from '@bond-os/database';
import { ConfirmDialog, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from '@bond-os/ui';
import { Trash2 } from 'lucide-react';

function formatMeetingDate(date: Date | string): string {
  return new Date(date).toLocaleString(undefined, {
    dateStyle: 'medium',
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

export function MeetingsTable({ meetings }: { meetings: MeetingListItem[] }) {
  const router = useRouter();

  async function handleDelete(id: string) {
    const response = await fetch(`/api/meetings/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Meeting deleted.');
    router.refresh();
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Date</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Attendees</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {meetings.map((meeting) => (
          <TableRow key={meeting.id}>
            <TableCell className="font-medium">
              <Link href={`/meetings/${meeting.id}`} className="hover:underline">
                {meeting.title}
              </Link>
            </TableCell>
            <TableCell>
              <Link href={`/projects/${meeting.project.id}`} className="text-sm hover:underline">
                {meeting.project.title}
              </Link>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{formatMeetingDate(meeting.meetingDate)}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{formatDuration(meeting.duration)}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{meeting.attendeeCount}</TableCell>
            <TableCell>
              <ConfirmDialog
                trigger={
                  <button
                    type="button"
                    className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                    aria-label={`Delete ${meeting.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                }
                title={`Delete "${meeting.title}"?`}
                description="This permanently deletes the meeting and its attendee list. This can't be undone."
                onConfirm={() => handleDelete(meeting.id)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
