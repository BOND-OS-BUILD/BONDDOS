import { AdminHeader } from '@/features/admin/components/admin-ui';
import { listRateLimitPoliciesService } from '@/features/rate-limits/services/rate-limit.service';

import { RateLimitManager } from './rate-limit-manager';

export const dynamic = 'force-dynamic';

export default async function AdminRateLimitsPage() {
  const policies = await listRateLimitPoliciesService();
  return (
    <div className="space-y-4">
      <AdminHeader
        title="Rate Limits"
        description="Configurable per-scope rate-limit policies enforced on user, org, API, AI, tool, and workflow traffic."
      />
      <RateLimitManager
        policies={policies.map((policy) => ({
          id: policy.id,
          scope: policy.scope,
          key: policy.key,
          limit: policy.limit,
          windowSeconds: policy.windowSeconds,
          enabled: policy.enabled,
        }))}
      />
    </div>
  );
}
