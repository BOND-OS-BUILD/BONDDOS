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
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bond-os/ui';
import { Workflow } from 'lucide-react';

import { getWorkflowRunService } from '@/features/workflows/lib/container';
import { getActiveOrganization } from '@/lib/organization';

/**
 * Phase 8 "Workflow Automation Platform" — every `WorkflowRun` (one row per
 * trigger firing) and how far it got. Mirrors `execution/page.tsx`'s
 * list-page shape exactly: same auth/org/role gate, same status-badge +
 * duration table, same `EmptyState` fallback.
 */

const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  PENDING: 'secondary',
  RUNNING: 'secondary',
  WAITING_APPROVAL: 'warning',
  WAITING_TIMER: 'warning',
  COMPLETED: 'success',
  FAILED: 'destructive',
  CANCELLED: 'outline',
  ROLLED_BACK: 'outline',
};

function formatDateTime(date: Date | string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}

export default async function WorkflowRunsPage() {
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
          <CardTitle>Workflow Runs</CardTitle>
          <CardDescription>Organization members can view workflow runs.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const result = await getWorkflowRunService().list({ organizationId: active.id, page: 1, pageSize: PAGE_SIZE });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Workflow Runs</h1>
        <p className="text-sm text-muted-foreground">
          Every workflow trigger firing and how far it got — running, waiting on a step, or finished.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <EmptyState
              icon={Workflow}
              title="No workflow runs yet"
              description="Runs will appear here once a workflow is triggered — by an event, a schedule, a webhook, or a manual run."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>
                    <span className="sr-only">Detail</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((run) => {
                  const duration = run.completedAt
                    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
                    : null;
                  return (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[run.status] ?? 'outline'}>{run.status}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDateTime(run.startedAt)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(run.completedAt)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDuration(duration)}</TableCell>
                      <TableCell>
                        <Link
                          href={`${ROUTES.workflowRuns}/${run.id}`}
                          className="text-sm font-medium underline underline-offset-4"
                        >
                          View
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
