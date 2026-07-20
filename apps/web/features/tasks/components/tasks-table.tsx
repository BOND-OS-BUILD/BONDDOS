'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { TaskListItem, UserSummary } from '@bond-os/database';
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
import { Pencil, Trash2 } from 'lucide-react';

import { PriorityBadge } from '@/features/shared/components/priority-badge';
import { TaskFormDialog } from '@/features/tasks/components/task-form-dialog';

const STATUS_LABEL: Record<string, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

export interface TasksTableProps {
  tasks: TaskListItem[];
  projects: Array<{ id: string; title: string }>;
  members: UserSummary[];
  documents?: Array<{ id: string; title: string }>;
}

export function TasksTable({ tasks, projects, members, documents = [] }: TasksTableProps) {
  const router = useRouter();

  async function handleDelete(id: string) {
    const response = await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Task deleted.');
    router.refresh();
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead>Project</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Priority</TableHead>
          <TableHead>Assignee</TableHead>
          <TableHead>Due date</TableHead>
          <TableHead className="w-20" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {tasks.map((task) => (
          <TableRow key={task.id}>
            <TableCell className="font-medium">{task.title}</TableCell>
            <TableCell>
              <Link href={`/projects/${task.project.id}`} className="text-sm hover:underline">
                {task.project.title}
              </Link>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{STATUS_LABEL[task.status] ?? task.status}</Badge>
            </TableCell>
            <TableCell>
              <PriorityBadge priority={task.priority} />
            </TableCell>
            <TableCell>
              {task.assignee ? (
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-xs">{task.assignee.name.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <span className="text-sm">{task.assignee.name}</span>
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">Unassigned</span>
              )}
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">
              {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-1">
                <TaskFormDialog
                  task={task}
                  projects={projects}
                  members={members}
                  documents={documents}
                  trigger={
                    <button
                      type="button"
                      className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                      aria-label={`Edit ${task.title}`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  }
                />
                <ConfirmDialog
                  trigger={
                    <button
                      type="button"
                      className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                      aria-label={`Delete ${task.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  }
                  title={`Delete "${task.title}"?`}
                  description="This permanently deletes the task. This can't be undone."
                  onConfirm={() => handleDelete(task.id)}
                />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
