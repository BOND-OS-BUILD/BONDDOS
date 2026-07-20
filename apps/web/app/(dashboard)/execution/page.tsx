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
import { History } from 'lucide-react';

import { listExecutionsService } from '@/features/execution/services/execution-history.service';
import { getActiveOrganization } from '@/lib/organization';

const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  DRAFT: 'secondary',
  AWAITING_APPROVAL: 'secondary',
  APPROVED: 'secondary',
  REJECTED: 'outline',
  EXPIRED: 'outline',
  EXECUTING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'destructive',
  ROLLING_BACK: 'warning',
  ROLLED_BACK: 'outline',
  CANCELLED: 'outline',
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

export default async function ExecutionHistoryPage() {
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
          <CardTitle>Execution History</CardTitle>
          <CardDescription>Organization members can view the tool execution history.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const result = await listExecutionsService(active.id, { page: 1, pageSize: PAGE_SIZE });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Execution History</h1>
        <p className="text-sm text-muted-foreground">
          Past tool executions run by Mr. Bond and their outcomes, for accountability and debugging.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Executions</CardTitle>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <EmptyState
              icon={History}
              title="No executions yet"
              description="Approved tool executions triggered from Mr. Bond will appear here."
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
                {result.items.map((execution) => (
                  <TableRow key={execution.id}>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[execution.status] ?? 'outline'}>{execution.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(execution.startedAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(execution.completedAt)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDuration(execution.duration)}
                    </TableCell>
                    <TableCell>
                      {/* Follow-up (out of scope here): /execution/[planId] detail page doesn't exist yet. */}
                      <Link
                        href={`${ROUTES.executionHistory}/${execution.planId}`}
                        className="text-sm font-medium underline underline-offset-4"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
