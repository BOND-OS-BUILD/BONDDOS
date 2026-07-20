import { prisma } from '../client';
import type { Prisma, RollbackSupport } from '../generated/index.js';

/** Planner-built plans (Phase 6) — `steps`/`graph` are Json, see `apps/web/features/planner/lib/dag.ts` for their exact shape. See docs/planner.md. */

export interface ExecutionPlanData {
  id: string;
  organizationId: string;
  conversationId: string | null;
  createdById: string | null;
  summary: string;
  steps: unknown;
  graph: unknown;
  planHash: string;
  estimatedTimeMs: number;
  rollbackStrategy: RollbackSupport;
  createdAt: Date;
}

export interface CreateExecutionPlanData {
  organizationId: string;
  conversationId?: string | null;
  createdById?: string | null;
  summary: string;
  steps: Prisma.InputJsonValue;
  graph: Prisma.InputJsonValue;
  planHash: string;
  estimatedTimeMs: number;
  rollbackStrategy: RollbackSupport;
}

export async function createExecutionPlan(data: CreateExecutionPlanData): Promise<ExecutionPlanData> {
  return prisma.executionPlan.create({ data });
}

export async function getExecutionPlanById(id: string, organizationId: string): Promise<ExecutionPlanData | null> {
  return prisma.executionPlan.findFirst({ where: { id, organizationId } });
}
