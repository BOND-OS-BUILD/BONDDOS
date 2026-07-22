import { requireAuth } from '@bond-os/auth';
import { ROLES, roleSatisfies } from '@bond-os/shared';
import { Card, CardContent } from '@bond-os/ui';

import { getOrgUsageSummary } from '@/features/metering/services/metering.service';
import { getSearchAnalyticsService } from '@/features/search-analytics/services/search-analytics.service';
import { getActiveOrganization } from '@/lib/organization';

import { AnalyticsTabs } from './analytics-tabs';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);
  if (!active) return null;

  if (!roleSatisfies(active.role, ROLES.ADMIN)) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Analytics are available to organization admins and owners.
          </CardContent>
        </Card>
      </div>
    );
  }

  const [usage, search] = await Promise.all([
    getOrgUsageSummary(active.id, { sinceDays: 30 }),
    getSearchAnalyticsService(active.id, { sinceDays: 30 }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground">{active.name} · last 30 days</p>
      </div>
      <AnalyticsTabs usage={usage} search={search} />
    </div>
  );
}
