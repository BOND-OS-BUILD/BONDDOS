'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { ProjectListItem } from '@bond-os/database';
import {
  Avatar,
  AvatarFallback,
  Badge,
  ConfirmDialog,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@bond-os/ui';
import { Trash2 } from 'lucide-react';

import { PriorityBadge } from '@/features/shared/components/priority-badge';

const STATUS_LABEL: Record<string, string> = {
  PLANNING: 'Planning',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

export function ProjectsTable({ projects }: { projects: ProjectListItem[] }) {
  const router = useRouter();

  async function handleDelete(id: string) {
    const response = await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Project deleted.');
    router.refresh();
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Owner</TableHead>
          <TableHead>Due date</TableHead>
          <TableHead>Tasks</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.id}>
            <TableCell className="font-medium">
              <Link href={`/projects/${project.id}`} className="hover:underline">
                {project.title}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{STATUS_LABEL[project.status] ?? project.status}</Badge>
            </TableCell>
            <TableCell>
              <PriorityBadge priority={project.priority} />
            </TableCell>
            <TableCell>
              {project.owner ? (
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs">{project.owner.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{project.owner.name}</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Unassigned</span>
              )}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {project.dueDate ? new Date(project.dueDate).toLocaleDateString() : '—'}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{project.taskCount}</TableCell>
            <TableCell>
              <ConfirmDialog
                trigger={
                  <button
                    type="button"
                    className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                    aria-label={`Delete ${project.title}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                }
                title={`Delete "${project.title}"?`}
                description="This permanently deletes the project and everything attached to it (tasks, documents, meetings). This can't be undone."
                onConfirm={() => handleDelete(project.id)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
