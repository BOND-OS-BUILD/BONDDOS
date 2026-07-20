import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { Priority, Prisma, TaskStatus } from '../generated/index.js';
import { toUserSummaryOrNull, userSummarySelect, type UserSummary } from './shared';

export interface TaskListFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  search?: string;
  sortBy: 'title' | 'status' | 'priority' | 'dueDate' | 'createdAt';
  sortDir: 'asc' | 'desc';
  status?: TaskStatus;
  priority?: Priority;
  projectId?: string;
  assigneeId?: string;
}

export interface TaskListItem {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate: Date | null;
  completedAt: Date | null;
  project: { id: string; title: string };
  assignee: UserSummary | null;
  documentIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskDetail extends TaskListItem {
  documents: Array<{ id: string; title: string; type: string }>;
}

const listInclude = {
  project: { select: { id: true, title: true } },
  assignee: { select: userSummarySelect },
  documents: { select: { documentId: true } },
} satisfies Prisma.TaskInclude;

type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof listInclude }>;

function toListItem(task: TaskWithRelations): TaskListItem {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    project: task.project,
    assignee: toUserSummaryOrNull(task.assignee),
    documentIds: task.documents.map((taskDocument) => taskDocument.documentId),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export async function listTasks(filters: TaskListFilters): Promise<PaginatedResult<TaskListItem>> {
  const { organizationId, page, pageSize, search, sortBy, sortDir, status, priority, projectId, assigneeId } =
    filters;

  const where: Prisma.TaskWhereInput = {
    organizationId,
    ...(status && { status }),
    ...(priority && { priority }),
    ...(projectId && { projectId }),
    ...(assigneeId && { assigneeId }),
    ...(search && { title: { contains: search, mode: 'insensitive' } }),
  };

  const [items, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: listInclude,
    }),
    prisma.task.count({ where }),
  ]);

  return {
    items: items.map(toListItem),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/**
 * Used internally by `createTask`/`updateTask` to return the full
 * `TaskDetail` (including linked documents) after a mutation. There's no
 * Task detail page, so this is intentionally not wrapped by a
 * `getTaskService` — only the repository needs it.
 */
export async function getTaskById(id: string, organizationId: string): Promise<TaskDetail | null> {
  const task = await prisma.task.findFirst({
    where: { id, organizationId },
    include: {
      project: { select: { id: true, title: true } },
      assignee: { select: userSummarySelect },
      documents: { select: { document: { select: { id: true, title: true, type: true } } } },
    },
  });

  if (!task) return null;

  const documents = task.documents.map((taskDocument) => taskDocument.document);

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    completedAt: task.completedAt,
    project: task.project,
    assignee: toUserSummaryOrNull(task.assignee),
    documentIds: documents.map((document) => document.id),
    documents,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export interface CreateTaskData {
  organizationId: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: Priority;
  dueDate?: Date | null;
  projectId: string;
  assigneeId?: string | null;
  documentIds: string[];
}

export async function createTask(data: CreateTaskData): Promise<TaskDetail> {
  const { documentIds, ...rest } = data;

  const task = await prisma.task.create({
    data: {
      ...rest,
      documents: { create: documentIds.map((documentId) => ({ documentId })) },
    },
  });

  const detail = await getTaskById(task.id, task.organizationId);
  if (!detail) throw new Error('Failed to load task immediately after creation.');
  return detail;
}

export interface UpdateTaskData {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  dueDate?: Date | null;
  projectId?: string;
  assigneeId?: string | null;
  documentIds?: string[];
}

/**
 * Updates a task, scoped to `organizationId` via `updateMany` (Prisma's
 * unique-`update` can't combine `id` with a non-unique `organizationId`
 * filter). Document-link replacement only runs if the scoped update actually
 * matched a row, so a cross-tenant `id` can't sneak a document-list mutation
 * through even though the field update itself was a no-op.
 */
export async function updateTask(
  id: string,
  organizationId: string,
  data: UpdateTaskData,
): Promise<TaskDetail | null> {
  const { documentIds, ...rest } = data;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.task.updateMany({ where: { id, organizationId }, data: rest });
    if (result.count === 0) return false;

    if (documentIds) {
      await tx.taskDocument.deleteMany({ where: { taskId: id } });
      if (documentIds.length > 0) {
        await tx.taskDocument.createMany({
          data: documentIds.map((documentId) => ({ taskId: id, documentId })),
          skipDuplicates: true,
        });
      }
    }

    return true;
  });

  if (!updated) return null;
  return getTaskById(id, organizationId);
}

export async function deleteTask(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.task.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
