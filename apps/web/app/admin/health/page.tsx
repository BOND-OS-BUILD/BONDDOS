import { Badge, Card, CardContent, CardHeader, CardTitle } from '@bond-os/ui';

import { AdminHeader, statusVariant } from '@/features/admin/components/admin-ui';
import { getHealthReport } from '@/features/health/services/health.service';

export const dynamic = 'force-dynamic';

export default async function AdminHealthPage() {
  const report = await getHealthReport();
  return (
    <div className="space-y-4">
      <AdminHeader
        title="System Health"
        description={`Version ${report.version} · checked ${new Date(report.timestamp).toLocaleTimeString()}`}
      />
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">Overall status</span>
        <Badge variant={statusVariant(report.status)}>{report.status}</Badge>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(report.components).map(([name, component]) => (
          <Card key={name}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between gap-2 text-sm capitalize">
                {name}
                <Badge variant={statusVariant(component.status)}>{component.status}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-xs text-muted-foreground">
              {component.latencyMs !== undefined ? <p>Latency: {component.latencyMs} ms</p> : null}
              {component.message ? <p>{component.message}</p> : null}
              {component.latencyMs === undefined && !component.message ? <p>Healthy.</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Probe endpoints: <code>/api/health</code>, <code>/api/health/live</code>, <code>/api/health/ready</code>
      </p>
    </div>
  );
}
