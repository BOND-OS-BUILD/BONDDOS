import { requireAuth } from '@bond-os/auth';

import { evaluateAllFlags } from '@/features/feature-flags/services/feature-flag.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { getActiveOrganization } from '@/lib/organization';

/**
 * Phase 10 — evaluated feature flags for the current user + active
 * organization. Any authenticated user may read their own resolved flags (to
 * gate client UI); managing flags is platform-admin-only (see
 * /api/admin/feature-flags).
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);
  const flags = await evaluateAllFlags({ organizationId: active?.id ?? null, userId: session.user.id });
  return apiSuccess({ flags });
});
