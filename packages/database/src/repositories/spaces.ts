import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { Prisma } from '../generated/index.js';
import { toUserSummaryOrNull, userSummarySelect, type UserSummary } from './shared';

/**
 * Team Spaces (Phase 9) — curation and grouping, NOT a parallel ACL (see
 * docs/spaces.md). `SpaceMember` is a plain roster, no space-specific role
 * tier. The 4 link tables (`SpaceProject`/`SpaceKnowledgeDocument`/
 * `SpaceWorkflow`/`SpaceAgent`) curate a view over existing org-owned
 * entities via a soft id reference (no hard FK — mirrors
 * `ExecutionStep.tool`'s "resolved at runtime, re-validated by the service
 * layer" precedent), so this repository only ever returns ids for them; the
 * service layer resolves display data from the owning feature. All child/
 * join models fold into this one file, matching `taskDocument`/
 * `meetingAttendee`'s own convention. See docs/spaces.md.
 */

export interface SpaceData {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdBy: UserSummary | null;
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SpaceDetail extends SpaceData {
  members: Array<{ user: UserSummary; joinedAt: Date }>;
  projectIds: string[];
  knowledgeDocumentIds: string[];
  workflowDefinitionIds: string[];
  agentKeys: string[];
}

const spaceListInclude = {
  createdBy: { select: userSummarySelect },
  _count: { select: { members: true } },
} satisfies Prisma.SpaceInclude;

type SpaceWithCount = Prisma.SpaceGetPayload<{ include: typeof spaceListInclude }>;

function toSpaceData(space: SpaceWithCount): SpaceData {
  return {
    id: space.id,
    organizationId: space.organizationId,
    name: space.name,
    description: space.description,
    createdBy: toUserSummaryOrNull(space.createdBy),
    memberCount: space._count.members,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  };
}

export interface ListSpacesFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  /** Restricts to spaces this user is a member of — "My Spaces" vs. the full org roster. */
  memberUserId?: string;
}

export async function listSpaces(filters: ListSpacesFilters): Promise<PaginatedResult<SpaceData>> {
  const { organizationId, page, pageSize, memberUserId } = filters;
  const where: Prisma.SpaceWhereInput = {
    organizationId,
    ...(memberUserId && { members: { some: { userId: memberUserId } } }),
  };

  const [items, total] = await Promise.all([
    prisma.space.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: spaceListInclude,
    }),
    prisma.space.count({ where }),
  ]);

  return { items: items.map(toSpaceData), page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getSpaceById(id: string, organizationId: string): Promise<SpaceDetail | null> {
  const space = await prisma.space.findFirst({
    where: { id, organizationId },
    include: {
      ...spaceListInclude,
      members: { include: { user: { select: userSummarySelect } }, orderBy: { joinedAt: 'asc' } },
      projects: { select: { projectId: true } },
      documents: { select: { knowledgeDocumentId: true } },
      workflows: { select: { workflowDefinitionId: true } },
      agents: { select: { agentKey: true } },
    },
  });

  if (!space) return null;

  return {
    ...toSpaceData(space),
    members: space.members.map((member) => ({ user: toUserSummaryOrNull(member.user) as UserSummary, joinedAt: member.joinedAt })),
    projectIds: space.projects.map((link) => link.projectId),
    knowledgeDocumentIds: space.documents.map((link) => link.knowledgeDocumentId),
    workflowDefinitionIds: space.workflows.map((link) => link.workflowDefinitionId),
    agentKeys: space.agents.map((link) => link.agentKey),
  };
}

export interface CreateSpaceData {
  organizationId: string;
  name: string;
  description?: string | null;
  createdById?: string | null;
}

export async function createSpace(data: CreateSpaceData): Promise<SpaceDetail> {
  const space = await prisma.space.create({ data });
  if (space.createdById) {
    await prisma.spaceMember.createMany({ data: [{ spaceId: space.id, userId: space.createdById }], skipDuplicates: true });
  }
  const detail = await getSpaceById(space.id, space.organizationId);
  if (!detail) throw new Error('Failed to load space immediately after creation.');
  return detail;
}

export interface UpdateSpaceData {
  name?: string;
  description?: string | null;
}

export async function updateSpace(id: string, organizationId: string, data: UpdateSpaceData): Promise<SpaceDetail | null> {
  const result = await prisma.space.updateMany({ where: { id, organizationId }, data });
  if (result.count === 0) return null;
  return getSpaceById(id, organizationId);
}

export async function deleteSpace(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.space.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}

/** Idempotent via `skipDuplicates` — joining a space twice is a no-op, not an error. */
export async function addSpaceMember(spaceId: string, userId: string): Promise<void> {
  await prisma.spaceMember.createMany({ data: [{ spaceId, userId }], skipDuplicates: true });
}

export async function removeSpaceMember(spaceId: string, userId: string): Promise<boolean> {
  const result = await prisma.spaceMember.deleteMany({ where: { spaceId, userId } });
  return result.count > 0;
}

export async function isSpaceMember(spaceId: string, userId: string): Promise<boolean> {
  const count = await prisma.spaceMember.count({ where: { spaceId, userId } });
  return count > 0;
}

export async function addProjectToSpace(spaceId: string, projectId: string): Promise<void> {
  await prisma.spaceProject.createMany({ data: [{ spaceId, projectId }], skipDuplicates: true });
}

export async function removeProjectFromSpace(spaceId: string, projectId: string): Promise<boolean> {
  const result = await prisma.spaceProject.deleteMany({ where: { spaceId, projectId } });
  return result.count > 0;
}

export async function addKnowledgeDocumentToSpace(spaceId: string, knowledgeDocumentId: string): Promise<void> {
  await prisma.spaceKnowledgeDocument.createMany({ data: [{ spaceId, knowledgeDocumentId }], skipDuplicates: true });
}

export async function removeKnowledgeDocumentFromSpace(spaceId: string, knowledgeDocumentId: string): Promise<boolean> {
  const result = await prisma.spaceKnowledgeDocument.deleteMany({ where: { spaceId, knowledgeDocumentId } });
  return result.count > 0;
}

export async function addWorkflowToSpace(spaceId: string, workflowDefinitionId: string): Promise<void> {
  await prisma.spaceWorkflow.createMany({ data: [{ spaceId, workflowDefinitionId }], skipDuplicates: true });
}

export async function removeWorkflowFromSpace(spaceId: string, workflowDefinitionId: string): Promise<boolean> {
  const result = await prisma.spaceWorkflow.deleteMany({ where: { spaceId, workflowDefinitionId } });
  return result.count > 0;
}

export async function addAgentToSpace(spaceId: string, agentKey: string): Promise<void> {
  await prisma.spaceAgent.createMany({ data: [{ spaceId, agentKey }], skipDuplicates: true });
}

export async function removeAgentFromSpace(spaceId: string, agentKey: string): Promise<boolean> {
  const result = await prisma.spaceAgent.deleteMany({ where: { spaceId, agentKey } });
  return result.count > 0;
}
