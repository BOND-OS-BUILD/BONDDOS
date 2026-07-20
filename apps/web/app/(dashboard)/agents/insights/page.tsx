import Link from 'next/link';
import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import type { InsightStatus, InsightType } from '@bond-os/database';
import { INSIGHT_STATUSES, insightListQuerySchema, ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import {
  Badge,
  type BadgeProps,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  Pagination,
} from '@bond-os/ui';
import { Lightbulb } from 'lucide-react';

import { InsightActions } from '@/features/agents/components/insight-actions';
import { getInsightService } from '@/features/agents/lib/container';
import { getActiveOrganization } from '@/lib/organization';

/** Color-codes by severity: RISK is the most urgent, CONFLICT needs a human call, the rest are informational. */
const TYPE_VARIANT: Record<InsightType, BadgeProps['variant']> = {
  RISK: 'destructive',
  CONFLICT: 'warning',
  MISSING_INFO: 'secondary',
  DUPLICATE: 'secondary',
  RECOMMENDATION: 'success',
};

const TYPE_LABEL: Record<InsightType, string> = {
  RISK: 'Risk',
  MISSING_INFO: 'Missing Info',
  CONFLICT: 'Conflict',
  DUPLICATE: 'Duplicate',
  RECOMMENDATION: 'Recommendation',
};

const STATUS_LABEL: Record<InsightStatus, string> = {
  OPEN: 'Open',
  ACKNOWLEDGED: 'Acknowledged',
  DISMISSED: 'Dismissed',
};

function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function AgentInsightsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
          <CardTitle>Agent Insights</CardTitle>
          <CardDescription>Organization members can view agent-generated insights.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const query = insightListQuerySchema.parse(await searchParams);
  // Default to OPEN so the page stays actionable instead of a wall of dismissed history.
  const status: InsightStatus = query.status ?? 'OPEN';

  const result = await getInsightService().list(active.id, {
    page: query.page,
    pageSize: query.pageSize,
    status,
  });

  const makeHref = (page: number) => {
    const params = new URLSearchParams();
    params.set('status', status);
    params.set('page', String(page));
    return `${ROUTES.agentInsights}?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agent Insights</h1>
        <p className="text-sm text-muted-foreground">
          Risks, missing information, conflicts, duplicates, and recommendations your agents have surfaced.
          Insights are never modified automatically — only their status changes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {INSIGHT_STATUSES.map((s) => (
          <Button key={s} asChild size="sm" variant={s === status ? 'default' : 'outline'}>
            <Link href={`${ROUTES.agentInsights}?status=${s}`}>{STATUS_LABEL[s]}</Link>
          </Button>
        ))}
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={Lightbulb}
          title={`No ${STATUS_LABEL[status].toLowerCase()} insights`}
          description="Insights surfaced by your agents — risks, missing information, conflicts, duplicates, and recommendations — will appear here."
        />
      ) : (
        <div className="space-y-4">
          {result.items.map((insight) => (
            <Card key={insight.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Badge variant={TYPE_VARIANT[insight.type]}>{TYPE_LABEL[insight.type]}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDateTime(insight.createdAt)}</span>
                    </div>
                    <CardTitle className="text-base">{insight.title}</CardTitle>
                  </div>
                  {insight.status === 'OPEN' ? <InsightActions insightId={insight.id} /> : null}
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{insight.description}</p>
              </CardContent>
            </Card>
          ))}
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
        </div>
      )}
    </div>
  );
}
