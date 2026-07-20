import { prisma } from '../client';
import type { GoalStepPhase, Prisma, TriggeredBy } from '../generated/index.js';

/**
 * One row per Plan/Observe/Suggest/Wait/Continue phase actually run for a
 * goal (Phase 7). `output` is structured only — never an internal
 * prompt/chain-of-thought dump. The one intentional exception is the
 * SUGGEST phase's `suggestion` field, which legitimately holds the model's
 * own advisory text (that's the point of a Suggest phase) — `GoalService`
 * bounds it to `MAX_SUGGESTION_LENGTH` before persisting so it can never
 * become an unbounded blob. See docs/goals.md.
 */

export interface GoalStepData {
  id: string;
  goalId: string;
  order: number;
  phase: GoalStepPhase;
  output: unknown;
  triggeredBy: TriggeredBy;
  createdAt: Date;
}

export interface CreateGoalStepData {
  goalId: string;
  order: number;
  phase: GoalStepPhase;
  output: Prisma.InputJsonValue;
  triggeredBy: TriggeredBy;
}

export async function createGoalStep(data: CreateGoalStepData): Promise<GoalStepData> {
  return prisma.goalStep.create({ data });
}

export async function listGoalSteps(goalId: string): Promise<GoalStepData[]> {
  return prisma.goalStep.findMany({ where: { goalId }, orderBy: { order: 'asc' } });
}

/** The next `order` value for a goal — one more than however many steps already exist. */
export async function countGoalSteps(goalId: string): Promise<number> {
  return prisma.goalStep.count({ where: { goalId } });
}
