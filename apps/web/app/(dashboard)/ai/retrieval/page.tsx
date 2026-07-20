import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@bond-os/ui';
import { Activity, Clock, Coins } from 'lucide-react';

import { getAiAuditStatsService, getModelManagementInfoService } from '@/features/ai/services/ai.service';
import { getActiveOrganization } from '@/lib/organization';

export default async function AiRetrievalPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const canView = roleSatisfies(active.role, ROLES.ADMIN);

  if (!canView) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Retrieval</CardTitle>
          <CardDescription>Admins and owners can view AI configuration.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const [auditStats, modelInfo] = await Promise.all([
    getAiAuditStatsService(active.id),
    getModelManagementInfoService(active.id),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Retrieval</h1>
        <p className="text-sm text-muted-foreground">
          Usage of the hybrid retrieval pipeline across your organization.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total AI requests" value={auditStats.totalRequests} icon={Activity} />
        <StatCard label="Requests (24h)" value={auditStats.last24h} icon={Clock} />
        <StatCard
          label="Context token budget"
          value={modelInfo.contextTokenBudget.toLocaleString()}
          icon={Coins}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Requests by action</CardTitle>
        </CardHeader>
        <CardContent>
          {auditStats.requestsByAction.length === 0 ? (
            <p className="text-sm text-muted-foreground">No retrieval activity yet.</p>
          ) : (
            <div className="space-y-2">
              {auditStats.requestsByAction.map((entry) => (
                <div key={entry.action} className="flex items-center gap-2">
                  <Badge variant="outline">{entry.action}</Badge>
                  <span className="text-sm text-muted-foreground">{entry.count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
