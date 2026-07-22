import Link from 'next/link';

import { getEnv } from '@bond-os/shared/server';
import { Card, CardContent, CardHeader, CardTitle } from '@bond-os/ui';

import { AdminHeader } from '@/features/admin/components/admin-ui';
import { listFeatureFlagsService } from '@/features/feature-flags/services/feature-flag.service';
import { listRateLimitPoliciesService } from '@/features/rate-limits/services/rate-limit.service';

export const dynamic = 'force-dynamic';

export default async function AdminSystemConfigPage() {
  const env = getEnv();
  const [{ flags }, policies] = await Promise.all([listFeatureFlagsService(), listRateLimitPoliciesService()]);
  const rows: Array<[string, string | number]> = [
    ['Embedding provider', env.EMBEDDING_PROVIDER],
    ['Embedding dimensions', env.EMBEDDING_DIMENSIONS],
    ['AI provider (deployment default)', env.AI_PROVIDER ?? 'per-organization'],
    ['Rate-limit default', `${env.RATE_LIMIT_DEFAULT_LIMIT} req / ${env.RATE_LIMIT_DEFAULT_WINDOW_SECONDS}s`],
    ['Storage soft-limit', `${env.STORAGE_LIMIT_MB} MB`],
    ['Error retention', `${env.ERROR_RETENTION_DAYS} days`],
    ['Usage retention', `${env.USAGE_RETENTION_DAYS} days`],
    ['Security-event retention', `${env.SECURITY_EVENT_RETENTION_DAYS} days`],
    ['Search-log retention', `${env.SEARCH_LOG_RETENTION_DAYS} days`],
    ['Feature-flag overrides', flags.length],
    ['Rate-limit policies', policies.length],
  ];
  return (
    <div className="space-y-4">
      <AdminHeader title="System Configuration" description="Effective platform configuration. Secrets are never shown here." />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Effective settings</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="divide-y">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-2 py-2 text-sm">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
          <span className="text-muted-foreground">Manage:</span>
          <Link className="font-medium underline" href="/admin/feature-flags">
            Feature Flags
          </Link>
          <Link className="font-medium underline" href="/admin/rate-limits">
            Rate Limits
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
