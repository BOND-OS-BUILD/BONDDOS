import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { listAgents } from '@bond-os/database';
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
import { Target } from 'lucide-react';

import { NewGoalButton } from '@/features/agents/components/new-goal-button';
import { getGoalService } from '@/features/agents/lib/container';
import { listAgentsService } from '@/features/agents/services/agent-discovery.service';
import { getActiveOrganization } from '@/lib/organization';

/**
 * Phase 7 "Multi-Agent Architecture" Goals list. Spec: "Plan -> Observe ->
 * Suggest -> Wait -> Continue. Goals persist. No automatic execution." —
 * this page only lists what already exists; advancing a goal always
 * requires an explicit click (see `GoalContinueButton` on the detail page).
 */

const PAGE_SIZE = 20;

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  ACTIVE: 'success',
  WAITING: 'warning',
  COMPLETED: 'secondary',
  CANCELLED: 'outline',
};

function formatDateTime(date: Date | string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AgentGoalsPage() {
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
          <CardTitle>Agent Goals</CardTitle>
          <CardDescription>Organization members can view agent goals.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [result, agentRecords, availableAgents] = await Promise.all([
    getGoalService().listGoals(active.id, { page: 1, pageSize: PAGE_SIZE }),
    listAgents(),
    listAgentsService(active.id),
  ]);

  const agentNameById = new Map(agentRecords.map((agent) => [agent.id, agent.displayName]));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agent Goals</h1>
          <p className="text-sm text-muted-foreground">
            Long-running goals agents work through one checkpoint at a time — Plan, Observe, Suggest, Wait, Continue.
            Goals persist and never advance on their own.
          </p>
        </div>
        <NewGoalButton agents={availableAgents} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Goals</CardTitle>
        </CardHeader>
        <CardContent>
          {result.items.length === 0 ? (
            <EmptyState
              icon={Target}
              title="No goals yet"
              description="Agents can be given long-running goals to work through — they plan, observe, and suggest next steps, then wait for you before continuing."
              action={<NewGoalButton agents={availableAgents} variant="outline" />}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Last Activity</TableHead>
                  <TableHead>
                    <span className="sr-only">Detail</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((goal) => (
                  <TableRow key={goal.id}>
                    <TableCell className="font-medium">{goal.title}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[goal.status] ?? 'outline'}>{goal.status}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {agentNameById.get(goal.agentId) ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDateTime(goal.lastActivityAt)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`${ROUTES.agentGoals}/${goal.id}`}
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
