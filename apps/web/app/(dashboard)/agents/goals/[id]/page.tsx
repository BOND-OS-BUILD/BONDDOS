import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { getAgentById } from '@bond-os/database';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import {
  Badge,
  type BadgeProps,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Separator,
} from '@bond-os/ui';

import { GoalContinueButton } from '@/features/agents/components/goal-continue-button';
import { getGoalService } from '@/features/agents/lib/container';
import { getActiveOrganization } from '@/lib/organization';

/**
 * Phase 7 Goal detail page — the title/status plus the full
 * Plan/Observe/Suggest/Wait/Continue step history. Advancing the goal is
 * always an explicit `GoalContinueButton` click; nothing here runs on its
 * own (spec: "No automatic execution").
 */

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  ACTIVE: 'success',
  WAITING: 'warning',
  COMPLETED: 'secondary',
  CANCELLED: 'outline',
};

const PHASE_VARIANT: Record<string, BadgeProps['variant']> = {
  PLAN: 'outline',
  OBSERVE: 'secondary',
  SUGGEST: 'warning',
  WAIT: 'outline',
  CONTINUE: 'success',
};

function formatDateTime(date: Date | string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AgentGoalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
          <CardTitle>Agent Goal</CardTitle>
          <CardDescription>Organization members can view agent goals.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { goal, steps } = await getGoalService().getGoal(id, active.id);
  const agent = await getAgentById(goal.agentId);
  const isFinished = goal.status === 'COMPLETED' || goal.status === 'CANCELLED';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{goal.title}</h1>
            <Badge variant={STATUS_VARIANT[goal.status] ?? 'outline'}>{goal.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {agent?.displayName ?? 'Unknown agent'} · Last activity {formatDateTime(goal.lastActivityAt)}
          </p>
        </div>
        <GoalContinueButton goalId={goal.id} status={goal.status} />
      </div>

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Steps ({steps.length})</CardTitle>
          <CardDescription>
            Plan → Observe → Suggest → Wait → Continue. Each step is a checkpoint; nothing advances until you ask it
            to.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No steps yet. {isFinished ? 'This goal is finished.' : 'Click Continue to run the first step.'}
            </p>
          ) : (
            <ol className="space-y-4">
              {steps.map((step) => (
                <li key={step.id} className="relative border-l border-border pl-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={PHASE_VARIANT[step.phase] ?? 'outline'}>{step.phase}</Badge>
                    <span className="text-xs text-muted-foreground">Step {step.order + 1}</span>
                    <span className="text-xs text-muted-foreground">· {formatDateTime(step.createdAt)}</span>
                    <span className="text-xs text-muted-foreground">· triggered by {step.triggeredBy}</span>
                  </div>
                  <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">
                    {JSON.stringify(step.output, null, 2)}
                  </pre>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
