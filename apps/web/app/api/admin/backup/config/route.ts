import { getConfigurationExport } from '@/features/admin/services/admin.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';

/**
 * Phase 10 — configuration export (platform admin). Returns feature flags +
 * rate-limit policies as a JSON snapshot for backup / migration between
 * environments. Database and storage exports are operator procedures — see
 * docs/backups.md.
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  return apiSuccess(await getConfigurationExport());
});
