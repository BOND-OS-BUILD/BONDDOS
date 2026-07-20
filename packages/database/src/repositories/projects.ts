import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { Priority, Prisma, ProjectStatus } from '../generated/index.js';
import { toUserSummary, toUserSummaryOrNull, userSummarySelect, type UserSummary } from './shared';

export interface ProjectListFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  search?: string;
  sortBy: 'title' | 'status' | 'priority' | 'dueDate' | 'createdAt';
  sortDir: 'asc' | 'desc';
  status?: ProjectStatus;
  priority?: Priority;
  ownerId?: string;
}

export interface ProjectListItem {
  id: string;
  title: string;
  description: string | null;
  status: ProjectStatus;
  priority: Priority;
  startDate: Date | null;
  dueDate: Date | null;
  owner: UserSummary | null;
  taskCount: number;
  documentCount: number;
  meetingCount: number;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectDetail extends ProjectListItem {
  organizationId: string;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueDate: Date | null;
    assignee: UserSummary | null;
  }>;
  documents: Array<{ id: string; title: string; type: string; fileName: string; createdAt: Date }>;
  meetings: Array<{ id: string; title: string; meetingDate: Date; location: string | null }>;
  members: UserSummary[];
}

const listInclude = {
  owner: { select: userSummarySelect },
  _count: { select: { tasks: true, documents: true, meetings: true, members: true } },
} satisfies Prisma.ProjectInclude;

type ProjectWithCounts = Prisma.ProjectGetPayload<{ include: typeof listInclude }>;

function toListItem(project: ProjectWithCounts): ProjectListItem {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    status: project.status,
    priority: project.priority,
    startDate: project.startDate,
    dueDate: project.dueDate,
    owner: toUserSummaryOrNull(project.owner),
    taskCount: project._count.tasks,
    documentCount: project._count.documents,
    meetingCount: project._count.meetings,
    memberCount: project._count.members,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export async function listProjects(filters: ProjectListFilters): Promise<PaginatedResult<ProjectListItem>> {
  const { organizationId, page, pageSize, search, sortBy, sortDir, status, priority, ownerId } = filters;

  const where: Prisma.ProjectWhereInput = {
    organizationId,
    ...(status && { status }),
    ...(priority && { priority }),
    ...(ownerId && { ownerId }),
    ...(search && { title: { contains: search, mode: 'insensitive' } }),
  };

  const [items, total] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: listInclude,
    }),
    prisma.project.count({ where }),
  ]);

  return {
    items: items.map(toListItem),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getProjectById(id: string, organizationId: string): Promise<ProjectDetail | null> {
  const project = await prisma.project.findFirst({
    where: { id, organizationId },
    include: {
      ...listInclude,
      tasks: {
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          assignee: { select: userSummarySelect },
        },
        orderBy: { createdAt: 'desc' },
      },
      documents: {
        select: { id: true, title: true, type: true, fileName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
      meetings: {
        select: { id: true, title: true, meetingDate: true, location: true },
        orderBy: { meetingDate: 'desc' },
      },
      members: { include: { user: { select: userSummarySelect } } },
    },
  });

  if (!project) return null;

  return {
    ...toListItem(project),
    organizationId: project.organizationId,
    tasks: project.tasks.map((task) => ({ ...task, assignee: toUserSummaryOrNull(task.assignee) })),
    documents: project.documents,
    meetings: project.meetings,
    members: project.members.map((member) => toUserSummary(member.user)),
  };
}

export interface CreateProjectData {
  organizationId: string;
  title: string;
  description?: string | null;
  status: ProjectStatus;
  priority: Priority;
  startDate?: Date | null;
  dueDate?: Date | null;
  ownerId?: string | null;
  memberIds: string[];
}

export async function createProject(data: CreateProjectData): Promise<ProjectDetail> {
  const { memberIds, ...rest } = data;

  const project = await prisma.project.create({
    data: {
      ...rest,
      members: { create: memberIds.map((userId) => ({ userId })) },
    },
  });

  const detail = await getProjectById(project.id, project.organizationId);
  if (!detail) throw new Error('Failed to load project immediately after creation.');
  return detail;
}

export interface UpdateProjectData {
  title?: string;
  description?: string | null;
  status?: ProjectStatus;
  priority?: Priority;
  startDate?: Date | null;
  dueDate?: Date | null;
  ownerId?: string | null;
  memberIds?: string[];
}

/**
 * Updates a project, scoped to `organizationId` via `updateMany` (Prisma's
 * unique-`update` can't combine `id` with a non-unique `organizationId`
 * filter). Member replacement only runs if the scoped update actually
 * matched a row, so a cross-tenant `id` can't sneak a member-list mutation
 * through even though the field update itself was a no-op.
 */
export async function updateProject(
  id: string,
  organizationId: string,
  data: UpdateProjectData,
): Promise<ProjectDetail | null> {
  const { memberIds, ...rest } = data;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.project.updateMany({ where: { id, organizationId }, data: rest });
    if (result.count === 0) return false;

    if (memberIds) {
      await tx.projectMember.deleteMany({ where: { projectId: id } });
      if (memberIds.length > 0) {
        await tx.projectMember.createMany({
          data: memberIds.map((userId) => ({ projectId: id, userId })),
          skipDuplicates: true,
        });
      }
    }

    return true;
  });

  if (!updated) return null;
  return getProjectById(id, organizationId);
}

export async function deleteProject(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.project.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
