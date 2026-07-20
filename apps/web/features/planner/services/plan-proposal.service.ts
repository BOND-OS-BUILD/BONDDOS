import { touchConversation, type ExecutionPlanData } from '@bond-os/database';

import { getApprovalService, getPlannerService, getToolRegistryService } from '@/features/execution/lib/container';
import type { ExecutionStepDefinition } from '@/features/planner/lib/dag';
import type { ToolContext } from '@/features/tools/lib/tool-definition';

import type { PlanRequest } from '../lib/plan-request';

/**
 * The build-plan-and-request-approval composition, shared by Mr. Bond's
 * in-pipeline `<<ACTION:...>>` handling (`rag-pipeline.service.ts`) and the
 * standalone `POST /api/execution/plan` route — kept in one place so both
 * callers describe a proposed plan identically instead of two slightly
 * different implementations drifting apart. See docs/planner.md.
 */

export interface ProposedStepSummary {
  key: string;
  toolKey: string;
  displayName: string;
  summary: string;
}

export interface ProposedPlan {
  plan: ExecutionPlanData;
  requiredRole: string;
  steps: ProposedStepSummary[];
  expiresAt: Date;
}

export async function proposeAction(ctx: ToolContext, request: PlanRequest): Promise<ProposedPlan> {
  const planner = getPlannerService();
  const approvalService = getApprovalService();
  const registry = getToolRegistryService();

  const { plan, requiredRole } = await planner.buildPlan(ctx, request);
  const approval = await approvalService.requestApproval(ctx.organizationId, plan.id, requiredRole);

  const stepDefs = plan.steps as unknown as ExecutionStepDefinition[];
  const steps: ProposedStepSummary[] = stepDefs.map((step) => {
    const tool = registry.get(step.toolKey, step.version);
    const summary = tool ? tool.describe(step.params) : `${step.toolKey} (unregistered)`;
    return {
      key: step.key,
      toolKey: step.toolKey,
      displayName: tool?.displayName ?? step.toolKey,
      summary: step.condition ? `${summary} (conditional — branch determined at execution time)` : summary,
    };
  });

  if (ctx.conversationId) {
    await touchConversation(ctx.conversationId, ctx.organizationId);
  }

  return { plan, requiredRole, steps, expiresAt: approval.expiresAt };
}
