import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { getApprovalRequestByPlanId, getExecutionPlanById, type ExecutionPlanData } from '@bond-os/database';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import { Card, CardDescription, CardHeader, CardTitle, EmptyState } from '@bond-os/ui';
import { ShieldCheck } from 'lucide-react';

import { ApprovalCard, type ApprovalCardProps, type ApprovalCardStep } from '@/features/execution/components/approval-card';
import { getToolRegistryService } from '@/features/execution/lib/container';
import { listExecutionsService } from '@/features/execution/services/execution-history.service';
import type { ExecutionStepDefinition } from '@/features/planner/lib/dag';
import { getActiveOrganization } from '@/lib/organization';

const PAGE_SIZE = 20;

/**
 * Phase 8 "Workflow Automation Platform" — every proposed action currently
 * waiting on a role-eligible approval, rendered with the EXISTING,
 * unmodified `ApprovalCard` (Phase 6) so approving here behaves identically
 * to approving from a Mr. Bond chat turn.
 *
 * `GET /api/workflows/approvals` (built alongside this page) reuses the
 * exact same `listExecutionsService(..., { status: 'AWAITING_APPROVAL' })`
 * call Phase 6's own `/api/execution` route already makes — see that
 * route's own doc comment for why (no org-wide "list pending approvals"
 * repository query exists). Called directly here, matching this codebase's
 * "server components call services directly" convention, rather than
 * fetching that route. `ToolExecutionData` only carries a `planId`, not the
 * summary/steps/requiredRole/expiry an `ApprovalCard` needs, so each row is
 * enriched from its `ExecutionPlan` + `ApprovalRequest` the same way
 * `proposeAction` (plan-proposal.service.ts) builds one at propose time.
 */

function toApprovalCardSteps(plan: ExecutionPlanData): ApprovalCardStep[] {
  const registry = getToolRegistryService();
  const stepDefs = plan.steps as unknown as ExecutionStepDefinition[];
  return stepDefs.map((step) => {
    const tool = registry.get(step.toolKey, step.version);
    const summary = tool ? tool.describe(step.params) : `${step.toolKey} (unregistered)`;
    return {
      key: step.key,
      toolKey: step.toolKey,
      displayName: tool?.displayName ?? step.toolKey,
      summary: step.condition ? `${summary} (conditional — branch determined at execution time)` : summary,
    };
  });
}

async function fetchPendingApprovals(organizationId: string): Promise<ApprovalCardProps[]> {
  const executions = await listExecutionsService(organizationId, {
    page: 1,
    pageSize: PAGE_SIZE,
    status: 'AWAITING_APPROVAL',
  });

  const cards = await Promise.all(
    executions.items.map(async (execution): Promise<ApprovalCardProps | null> => {
      const [plan, approval] = await Promise.all([
        getExecutionPlanById(execution.planId, organizationId),
        getApprovalRequestByPlanId(execution.planId, organizationId),
      ]);
      if (!plan || !approval || approval.status !== 'PENDING') return null;

      return {
        planId: plan.id,
        summary: plan.summary,
        steps: toApprovalCardSteps(plan),
        requiredRole: approval.requiredRole,
        estimatedTimeMs: plan.estimatedTimeMs,
        rollbackStrategy: plan.rollbackStrategy,
        expiresAt: approval.expiresAt.toISOString(),
      };
    }),
  );

  return cards.filter((card): card is ApprovalCardProps => card !== null);
}

export default async function WorkflowApprovalsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const canView = roleSatisfies(active.role, ROLES.MEMBER);

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Pending Approvals</CardTitle>
          <CardDescription>Organization members can view pending approvals.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const approvals = await fetchPendingApprovals(active.id);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pending Approvals</h1>
        <p className="text-sm text-muted-foreground">
          Proposed actions — from workflows or Mr. Bond — waiting on a role-eligible approval before they run.
        </p>
      </div>

      {approvals.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No pending approvals"
          description="Nothing is waiting on your approval right now."
        />
      ) : (
        <div className="space-y-4">
          {approvals.map((approval) => (
            <ApprovalCard key={approval.planId} {...approval} />
          ))}
        </div>
      )}
    </div>
  );
}
