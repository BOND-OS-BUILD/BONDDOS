import { securityEventQuerySchema } from '@bond-os/shared';
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@bond-os/ui';

import { AdminHeader, AdminPager, parsePage, TableCard } from '@/features/admin/components/admin-ui';
import { getPlatformSecurityEvents } from '@/features/security/services/security.service';

export const dynamic = 'force-dynamic';

const TYPE_LABELS: Record<string, string> = {
  LOGIN_SUCCEEDED: 'Login',
  LOGIN_FAILED: 'Failed login',
  AUTH_REQUIRED: 'Auth required',
  PERMISSION_DENIED: 'Permission denied',
  APPROVAL_FAILED: 'Failed approval',
  TOOL_BLOCKED: 'Blocked tool',
  RATE_LIMIT_EXCEEDED: 'Rate-limit violation',
  CROSS_ORG_ATTEMPT: 'Cross-org attempt',
};

export default async function AdminSecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = parsePage((await searchParams).page);
  const query = securityEventQuerySchema.parse({ page, sinceDays: 30 });
  const { events, stats, sinceDays } = await getPlatformSecurityEvents(query);
  return (
    <div className="space-y-4">
      <AdminHeader title="Security" description={`Security events across the deployment (last ${sinceDays} days).`} />
      <div className="flex flex-wrap gap-2">
        {stats.byType.length === 0 ? (
          <p className="text-sm text-muted-foreground">No security events recorded in this window.</p>
        ) : null}
        {stats.byType.map((stat) => (
          <Badge key={stat.type} variant="secondary">
            {TYPE_LABELS[stat.type] ?? stat.type}: {stat.count}
          </Badge>
        ))}
      </div>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>IP address</TableHead>
              <TableHead>Route</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.items.map((event) => (
              <TableRow key={event.id}>
                <TableCell>
                  <Badge variant="outline">{TYPE_LABELS[event.type] ?? event.type}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{event.ipAddress ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{event.route ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{event.createdAt.toLocaleString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
      <AdminPager page={events.page} totalPages={events.totalPages} basePath="/admin/security" />
    </div>
  );
}
