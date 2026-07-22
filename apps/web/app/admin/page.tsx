import { Building2, Coins, Cpu, MessageSquare, ShieldCheck, Users, Workflow, Wrench } from 'lucide-react';

import { Badge, Card, CardContent, CardHeader, CardTitle, StatCard } from '@bond-os/ui';

import { getAdminOverview } from '@/features/admin/services/admin.service';
import { statusVariant } from '@/features/admin/components/admin-ui';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const { stats, health, aiUsage } = await getAdminOverview();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-muted-foreground">Deployment-wide administration, usage, and health.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Organizations" value={stats.organizations} icon={Building2} />
        <StatCard
          label="Users"
          value={stats.users}
          icon={Users}
          description={`${stats.platformAdmins} platform admin${stats.platformAdmins === 1 ? '' : 's'}`}
        />
        <StatCard label="Active Sessions" value={stats.activeSessions} icon={ShieldCheck} />
        <StatCard label="AI Requests (24h)" value={stats.aiRequests24h} icon={Cpu} />
        <StatCard label="Workflow Runs" value={stats.workflowRuns} icon={Workflow} />
        <StatCard label="Tool Executions" value={stats.toolExecutions} icon={Wrench} />
        <StatCard label="Conversations" value={stats.conversations} icon={MessageSquare} />
        <StatCard label="AI Tokens (30d)" value={aiUsage.totalTokens.toLocaleString()} icon={Coins} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            System Health <Badge variant={statusVariant(health.status)}>{health.status}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {Object.entries(health.components).map(([name, component]) => (
              <div key={name} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium capitalize">{name}</span>
                  <Badge variant={statusVariant(component.status)}>{component.status}</Badge>
                </div>
                {component.latencyMs !== undefined ? (
                  <p className="mt-1 text-xs text-muted-foreground">{component.latencyMs} ms</p>
                ) : null}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
