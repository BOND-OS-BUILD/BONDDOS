import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { GoalStatus, Prisma } from '../generated/index.js';

/** Long-running goals (Phase 7) — immutable `originalPlan` + status only; the Plan/Observe/Suggest/Wait/Continue history lives in `GoalStep`, not here. See docs/goals.md. */

export interface AgentGoalData {
  id: string;
  organizationId: string;
  agentId: string;
  conversationId: string | null;
  createdById: string | null;
  title: string;
  originalPlan: unknown;
  status: GoalStatus;
  lastActivityAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAgentGoalData {
  organizationId: string;
  agentId: string;
  conversationId?: string | null;
  createdById?: string | null;
  title: string;
  originalPlan: Prisma.InputJsonValue;
}

export async function createAgentGoal(data: CreateAgentGoalData): Promise<AgentGoalData> {
  return prisma.agentGoal.create({ data });
}

export async function getAgentGoalById(id: string, organizationId: string): Promise<AgentGoalData | null> {
  return prisma.agentGoal.findFirst({ where: { id, organizationId } });
}

export interface ListAgentGoalsFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  status?: GoalStatus;
}

export async function listAgentGoals(filters: ListAgentGoalsFilters): Promise<PaginatedResult<AgentGoalData>> {
  const { organizationId, page, pageSize, status } = filters;
  const where = { organizationId, ...(status && { status }) };

  const [items, total] = await Promise.all([
    prisma.agentGoal.findMany({
      where,
      orderBy: { lastActivityAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.agentGoal.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface UpdateAgentGoalStatusData {
  status: GoalStatus;
}

/** Bumps `lastActivityAt` alongside any status change — the only place this codebase ever advances it, always from an explicit caller action, never a timer. */
export async function updateAgentGoalStatus(
  id: string,
  organizationId: string,
  data: UpdateAgentGoalStatusData,
): Promise<void> {
  await prisma.agentGoal.updateMany({ where: { id, organizationId }, data: { ...data, lastActivityAt: new Date() } });
}

export async function touchAgentGoal(id: string, organizationId: string): Promise<void> {
  await prisma.agentGoal.updateMany({ where: { id, organizationId }, data: { lastActivityAt: new Date() } });
}
