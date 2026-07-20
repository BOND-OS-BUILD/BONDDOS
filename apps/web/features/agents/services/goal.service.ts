import { requireRole } from '@bond-os/auth';
import {
  createAgentGoal,
  createGoalStep,
  getAgentById,
  getAgentByKey,
  getAgentGoalById,
  listAgentGoals,
  listGoalSteps,
  updateAgentGoalStatus,
  type AgentGoalData,
  type GoalStatus,
  type GoalStepData,
  type GoalStepPhase,
  type Prisma,
} from '@bond-os/database';
import { NotFoundError, ROLES, ValidationError, type PaginatedResult } from '@bond-os/shared';

import { buildAgentContext, createRootDelegationBudget } from '../lib/context';
import { getAgentRegistry } from '../registry';

/**
 * Long-running Goals (Phase 7 spec: "Plan -> Observe -> Suggest -> Wait ->
 * Continue. Goals persist. No automatic execution."). `advance()` runs
 * exactly ONE more `GoalStep` and returns — it is only ever called from an
 * explicit trigger (a user visiting the Goal detail page, or an explicit
 * "Continue" button/API call), never a background loop: no scheduler
 * exists anywhere in this codebase to drive one. See docs/goals.md.
 */

const PHASE_CYCLE: GoalStepPhase[] = ['PLAN', 'OBSERVE', 'SUGGEST', 'WAIT', 'CONTINUE'];

/** Matches `sendBondMessageSchema`'s own content bound — the SUGGEST phase's model output is legitimate structured content (unlike chain-of-thought), but still must never be an unbounded blob. */
const MAX_SUGGESTION_LENGTH = 8000;

export class GoalService {
  async createGoal(
    organizationId: string,
    userId: string,
    input: { agentKey: string; title: string; conversationId?: string },
  ): Promise<AgentGoalData> {
    await requireRole(organizationId, ROLES.MEMBER);

    const agent = getAgentRegistry().get(input.agentKey);
    if (!agent) throw new NotFoundError(`Unknown agent "${input.agentKey}".`);

    const registeredAgent = await getAgentByKey(input.agentKey, agent.descriptor.version);
    if (!registeredAgent) throw new NotFoundError(`Agent "${input.agentKey}" has not been synced to the database yet.`);

    return createAgentGoal({
      organizationId,
      agentId: registeredAgent.id,
      conversationId: input.conversationId ?? null,
      createdById: userId,
      title: input.title,
      originalPlan: agent.plan(input.title) as unknown as Prisma.InputJsonValue,
    });
  }

  async getGoal(id: string, organizationId: string): Promise<{ goal: AgentGoalData; steps: GoalStepData[] }> {
    await requireRole(organizationId, ROLES.MEMBER);

    const goal = await getAgentGoalById(id, organizationId);
    if (!goal) throw new NotFoundError('Goal not found.');

    const steps = await listGoalSteps(id);
    return { goal, steps };
  }

  async listGoals(
    organizationId: string,
    filters: { page: number; pageSize: number; status?: GoalStatus },
  ): Promise<PaginatedResult<AgentGoalData>> {
    await requireRole(organizationId, ROLES.MEMBER);
    return listAgentGoals({ organizationId, ...filters });
  }

  /**
   * Runs exactly one more phase of the goal's Plan/Observe/Suggest/Wait/
   * Continue cycle and appends one `GoalStep`. `OBSERVE` calls the owning
   * agent's real `observe()` (a deterministic diff query); every other
   * phase produces a structured, deterministic note — none of them write
   * domain data or auto-execute anything, matching "no automatic execution."
   */
  async advance(id: string, organizationId: string, userId: string): Promise<GoalStepData> {
    const { membership } = await requireRole(organizationId, ROLES.MEMBER);

    const goal = await getAgentGoalById(id, organizationId);
    if (!goal) throw new NotFoundError('Goal not found.');
    if (goal.status === 'COMPLETED' || goal.status === 'CANCELLED') {
      throw new ValidationError(`Goal is ${goal.status.toLowerCase()} and cannot be advanced.`);
    }

    const registeredAgent = await getAgentById(goal.agentId);
    if (!registeredAgent) throw new NotFoundError('The agent that owns this goal is no longer registered.');

    const agent = getAgentRegistry().get(registeredAgent.agentKey, registeredAgent.version);
    if (!agent) throw new NotFoundError('The agent that owns this goal is no longer registered.');

    const priorSteps = await listGoalSteps(id);
    const phase = PHASE_CYCLE[priorSteps.length % PHASE_CYCLE.length]!;

    const output = await this.runPhase(phase, {
      organizationId,
      userId,
      conversationId: goal.conversationId ?? undefined,
      role: membership.role,
      agent,
    }, goal.title);

    const step = await createGoalStep({
      goalId: id,
      order: priorSteps.length,
      phase,
      output: output as unknown as Prisma.InputJsonValue,
      triggeredBy: 'USER',
    });

    const nextStatus: GoalStatus = phase === 'WAIT' ? 'WAITING' : 'ACTIVE';
    await updateAgentGoalStatus(id, organizationId, { status: nextStatus });

    return step;
  }

  async cancel(id: string, organizationId: string): Promise<void> {
    await requireRole(organizationId, ROLES.MEMBER);
    await updateAgentGoalStatus(id, organizationId, { status: 'CANCELLED' });
  }

  async complete(id: string, organizationId: string): Promise<void> {
    await requireRole(organizationId, ROLES.MEMBER);
    await updateAgentGoalStatus(id, organizationId, { status: 'COMPLETED' });
  }

  private async runPhase(
    phase: GoalStepPhase,
    ctxInput: Parameters<typeof buildAgentContext>[0],
    goalTitle: string,
  ): Promise<Record<string, unknown>> {
    if (phase === 'PLAN') {
      return { planSteps: ctxInput.agent.plan(goalTitle) };
    }

    if (phase === 'OBSERVE') {
      const ctx = await buildAgentContext(ctxInput);
      const observations = await ctxInput.agent.observe(ctx);
      return { observations };
    }

    if (phase === 'SUGGEST') {
      const ctx = await buildAgentContext(ctxInput);
      const budget = createRootDelegationBudget(ctxInput.agent.descriptor.agentKey);
      let suggestion = '';
      for await (const event of ctxInput.agent.think(ctx, `Given this goal ("${goalTitle}"), what would you suggest doing next?`, [], budget)) {
        if (event.type === 'token') suggestion += event.text;
      }
      // Goals created without a conversationId never get a persisted Message
      // for this turn (see runThinkLoop's `if (ctx.conversationId)` guard),
      // making GoalStep.output the only surviving record — bounded the same
      // way sendBondMessageSchema bounds a user turn, so this stays a
      // structured, size-capped field rather than an unbounded completion
      // dump. See the doc comment on GoalStepData.output in goal-steps.ts.
      const truncated = suggestion.length > MAX_SUGGESTION_LENGTH;
      return { suggestion: suggestion.slice(0, MAX_SUGGESTION_LENGTH), truncated };
    }

    // WAIT / CONTINUE — deterministic, no LLM call, no data write. "Goals
    // persist. No automatic execution" means these phases are checkpoints
    // for a human to act on, not steps that do something on their own.
    return { note: `${phase} — waiting for explicit user input before this goal advances further.` };
  }
}
