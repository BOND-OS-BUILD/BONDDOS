import { AdminHeader } from '@/features/admin/components/admin-ui';
import { listFeatureFlagsService } from '@/features/feature-flags/services/feature-flag.service';

import { FeatureFlagManager } from './feature-flag-manager';

export const dynamic = 'force-dynamic';

export default async function AdminFeatureFlagsPage() {
  const { definitions, flags } = await listFeatureFlagsService();
  return (
    <div className="space-y-4">
      <AdminHeader
        title="Feature Flags"
        description="Global, organization, and user-scoped flags. Precedence: user > organization > global."
      />
      <FeatureFlagManager
        definitions={definitions}
        flags={flags.map((flag) => ({
          id: flag.id,
          key: flag.key,
          scope: flag.scope,
          scopeId: flag.scopeId,
          enabled: flag.enabled,
        }))}
      />
    </div>
  );
}
