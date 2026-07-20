import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bond-os/ui';
import { Activity, Bot, DollarSign, Info, MessageSquare, TriangleAlert } from 'lucide-react';

import { getAgentStatusService, type AgentStatus } from '@/features/agents/services/agent-discovery.service';
import { getCostSummaryService } from '@/features/bond/services/cost-tracking.service';
import { getActiveOrganization } from '@/lib/organization';

const SINCE_DAYS = 30;

function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

/** Est. Cost column — always 4 decimal places, since per-agent spend can be a small fraction of a cent. */
function formatUsd4(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function resolveAgentLabel(agentKey: string, statuses: AgentStatus[]): string {
  if (agentKey === 'bond') return 'Mr. Bond';
  return statuses.find((status) => status.agentKey === agentKey)?.displayName ?? agentKey;
}

export default async function AgentDashboardPage() {
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
          <CardTitle>Agent Dashboard</CardTitle>
          <CardDescription>Organization members can view the agent dashboard.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [costSummary, agentStatuses] = await Promise.all([
    getCostSummaryService(active.id, { sinceDays: SINCE_DAYS }),
    getAgentStatusService(active.id),
  ]);

  const hasUsage = costSummary.totalMessages > 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Health and estimated spend per agent over the last {SINCE_DAYS} days.
        </p>
      </div>

      <Card className="border-amber-500/50 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 pt-6">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-muted-foreground">
            Cost figures are an <span className="font-medium text-foreground">approximation</span> — estimated from
            a hardcoded per-model rate table applied to recorded token usage, not pulled from your provider&apos;s
            billing. Treat them as directional, not exact billing.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border bg-muted/40">
        <CardContent className="flex items-start gap-3 pt-6">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Delegations and tool calls are not yet tracked</span> on
            this dashboard — only messages, tokens, and estimated cost per agent are aggregated today. Rather than
            show invented or partial counts, this data is omitted until it&apos;s actually collected.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total estimated cost"
          value={formatUsd(costSummary.totalCostUsd)}
          icon={DollarSign}
          description={`Last ${SINCE_DAYS} days`}
        />
        <StatCard
          label="Total messages"
          value={formatNumber(costSummary.totalMessages)}
          icon={MessageSquare}
          description="Assistant replies with recorded usage"
        />
        <StatCard
          label="Total agents"
          value={formatNumber(agentStatuses.length)}
          icon={Bot}
          description="Registered in the agent registry"
        />
      </div>

      {!hasUsage ? (
        <EmptyState
          icon={Activity}
          title="No agent usage yet"
          description="Cost and message breakdown by agent will appear here once conversations generate token usage."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Cost by agent</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead>Prompt Tokens</TableHead>
                  <TableHead>Completion Tokens</TableHead>
                  <TableHead>Est. Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {costSummary.byAgent.map((row) => (
                  <TableRow key={row.agentKey}>
                    <TableCell className="font-medium">{resolveAgentLabel(row.agentKey, agentStatuses)}</TableCell>
                    <TableCell>{formatNumber(row.messages)}</TableCell>
                    <TableCell>{formatNumber(row.promptTokens)}</TableCell>
                    <TableCell>{formatNumber(row.completionTokens)}</TableCell>
                    <TableCell>{formatUsd4(row.costUsd)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Agent health</CardTitle>
          <CardDescription>Live provider health checks — not fabricated uptime or metrics.</CardDescription>
        </CardHeader>
        <CardContent>
          {agentStatuses.length === 0 ? (
            <EmptyState title="No agents registered" description="No agents are currently registered for this organization." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Health</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agentStatuses.map((status) => (
                  <TableRow key={status.agentKey}>
                    <TableCell className="font-medium">{status.displayName}</TableCell>
                    <TableCell>
                      <Badge variant={status.health.healthy ? 'success' : 'destructive'}>
                        {status.health.healthy ? 'Healthy' : 'Unhealthy'}
                      </Badge>
                      {status.health.message ? (
                        <p className="mt-1 text-xs text-muted-foreground">{status.health.message}</p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.health.providerHealthy ? 'success' : 'destructive'}>
                        {status.health.providerHealthy ? 'Provider healthy' : 'Provider unavailable'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {typeof status.health.latencyMs === 'number' ? `${formatNumber(status.health.latencyMs)} ms` : '—'}
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
