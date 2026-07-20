import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import {
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
import { Coins, DollarSign, MessageSquare, TriangleAlert } from 'lucide-react';

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

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

export default async function AiCostPage() {
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
          <CardTitle>Cost</CardTitle>
          <CardDescription>Organization members can view AI cost estimates.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const summary = await getCostSummaryService(active.id, { sinceDays: SINCE_DAYS });
  const totalTokens = summary.totalPromptTokens + summary.totalCompletionTokens;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cost</h1>
        <p className="text-sm text-muted-foreground">Estimated AI spend over the last {SINCE_DAYS} days.</p>
      </div>

      <Card className="border-amber-500/50 bg-amber-500/5">
        <CardContent className="flex items-start gap-3 pt-6">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-sm text-muted-foreground">
            These figures are an <span className="font-medium text-foreground">approximation</span> — costs are
            estimated from a hardcoded per-model rate table applied to recorded token usage, not pulled from your
            provider&apos;s billing. Treat them as directional, not exact billing.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total estimated cost"
          value={formatUsd(summary.totalCostUsd)}
          icon={DollarSign}
          description={`Last ${SINCE_DAYS} days`}
        />
        <StatCard
          label="Total tokens"
          value={formatNumber(totalTokens)}
          icon={Coins}
          description={`${formatNumber(summary.totalPromptTokens)} prompt / ${formatNumber(summary.totalCompletionTokens)} completion`}
        />
        <StatCard
          label="Total messages"
          value={formatNumber(summary.totalMessages)}
          icon={MessageSquare}
          description="Assistant replies with recorded usage"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost by model</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.byModel.length === 0 ? (
            <EmptyState
              title="No usage yet"
              description="Cost breakdown by model will appear here once conversations generate token usage."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Messages</TableHead>
                  <TableHead>Prompt tokens</TableHead>
                  <TableHead>Completion tokens</TableHead>
                  <TableHead>Estimated cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byModel.map((row) => (
                  <TableRow key={row.model}>
                    <TableCell className="font-mono text-sm">{row.model}</TableCell>
                    <TableCell>{formatNumber(row.messages)}</TableCell>
                    <TableCell>{formatNumber(row.promptTokens)}</TableCell>
                    <TableCell>{formatNumber(row.completionTokens)}</TableCell>
                    <TableCell>{formatUsd(row.costUsd)}</TableCell>
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
