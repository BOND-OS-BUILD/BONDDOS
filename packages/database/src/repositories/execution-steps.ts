import { prisma } from '../client';
import type { Prisma, StepStatus } from '../generated/index.js';

/** One row per DAG step per execution attempt (Phase 6). `tool` stores the toolKey, not an FK — see the schema comment. See docs/planner.md. */

export interface ExecutionStepData {
  id: string;
  executionId: string;
  order: number;
  tool: string;
  status: StepStatus;
  duration: number | null;
  result: unknown;
  rollback: unknown;
  createdAt: Date;
}

export interface CreateExecutionStepData {
  executionId: string;
  order: number;
  tool: string;
}

/** Batch-inserts one PENDING row per plan step, in the order the Planner produced them — called once when a `ToolExecution` is created. */
export async function createExecutionSteps(steps: CreateExecutionStepData[]): Promise<void> {
  if (steps.length === 0) return;
  await prisma.executionStep.createMany({ data: steps.map((step) => ({ ...step, status: 'PENDING' as const })) });
}

export async function listExecutionSteps(executionId: string): Promise<ExecutionStepData[]> {
  return prisma.executionStep.findMany({ where: { executionId }, orderBy: { order: 'asc' } });
}

export interface UpdateExecutionStepData {
  status: StepStatus;
  duration?: number;
  result?: Prisma.InputJsonValue;
  rollback?: Prisma.InputJsonValue;
}

/**
 * Keyed by `(executionId, order)`, not the row's own `id` — `createExecutionSteps`
 * is a batched `createMany`, which Prisma doesn't return generated ids for,
 * and `order` is already a stable, unique-per-execution correlation key
 * matching the plan's own flattened layer order, so there's no need for a
 * separate round-trip lookup just to learn each row's id before updating it.
 */
export async function updateExecutionStep(executionId: string, order: number, data: UpdateExecutionStepData): Promise<void> {
  await prisma.executionStep.updateMany({ where: { executionId, order }, data });
}
