import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
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

import { getWorkflowRunService } from '@/features/workflows/lib/container';
import { getActiveOrganization } from '@/lib/organization';

import { CancelRunButton } from './cancel-run-button';

/**
 * Phase 8 Workflow Run detail — run-level status/timestamps/error plus the
 * full ordered `WorkflowRunStep` history, each with its own status, raw
 * input/output, and (for a step still `WAITING_APPROVAL`) a link out to the
 * existing, unmodified Phase 6 approval UI at `/execution/[planId]` — this
 * page never re-implements approval itself. Mirrors the shape of
 * `agents/goals/[id]/page.tsx`.
 */

const RUN_STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  PENDING: 'secondary',
  RUNNING: 'secondary',
  WAITING_APPROVAL: 'warning',
  WAITING_TIMER: 'warning',
  COMPLETED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'outline',
  ROLLED_BACK: 'outline',
};

const STEP_STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  PENDING: 'secondary',
  RUNNING: 'secondary',
  WAITING_APPROVAL: 'warning',
  WAITING_TIMER: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'destructive',
  SKIPPED: 'outline',
  ROLLED_BACK: 'outline',
};

const TERMINAL_RUN_STATUSES = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'ROLLED_BACK']);

function formatDateTime(date: Date | string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function WorkflowRunDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
          <CardTitle>Workflow Run</CardTitle>
          <CardDescription>Organization members can view workflow runs.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const { run, steps } = await getWorkflowRunService().get(id, active.id);
  const isTerminal = TERMINAL_RUN_STATUSES.has(run.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Workflow Run</h1>
            <Badge variant={RUN_STATUS_VARIANT[run.status] ?? 'outline'}>{run.status}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Started {formatDateTime(run.startedAt)} · Completed {formatDateTime(run.completedAt)}
          </p>
          <p className="font-mono text-xs text-muted-foreground">Correlation ID {run.correlationId}</p>
        </div>
        {!isTerminal ? <CancelRunButton runId={run.id} /> : null}
      </div>

      {run.error ? (
        <Card className="border-destructive/40">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="text-sm text-destructive">{run.error}</p>
          </CardContent>
        </Card>
      ) : null}

      <Separator />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Steps ({steps.length})</CardTitle>
          <CardDescription>Every step this run has created, in order, with its current status and I/O.</CardDescription>
        </CardHeader>
        <CardContent>
          {steps.length === 0 ? (
            <p className="text-sm text-muted-foreground">No steps recorded yet.</p>
          ) : (
            <ol className="space-y-4">
              {steps.map((step) => (
                <li key={step.id} className="relative border-l border-border pl-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{step.key}</span>
                    <Badge variant="outline">{step.stepType}</Badge>
                    <Badge variant={STEP_STATUS_VARIANT[step.status] ?? 'outline'}>{step.status}</Badge>
                    {step.attempt > 1 ? (
                      <span className="text-xs text-muted-foreground">attempt {step.attempt}</span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">· {formatDateTime(step.createdAt)}</span>
                  </div>

                  {step.error ? <p className="mt-1 text-xs text-destructive">{step.error}</p> : null}

                  {step.status === 'WAITING_APPROVAL' && step.planId ? (
                    <p className="mt-2 text-sm">
                      <Link
                        href={`${ROUTES.executionHistory}/${step.planId}`}
                        className="font-medium underline underline-offset-4"
                      >
                        Review and approve this step →
                      </Link>
                    </p>
                  ) : null}

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Input</p>
                      <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">
                        {JSON.stringify(step.input, null, 2)}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-1 text-xs font-medium text-muted-foreground">Output</p>
                      <pre className="max-h-80 overflow-auto rounded-md border border-border bg-muted p-3 text-xs">
                        {JSON.stringify(step.output, null, 2)}
                      </pre>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
