import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';

import { listApiKeysService } from '@/features/api-keys/services/api-key.service';
import { getActiveOrganization } from '@/lib/organization';

import { ApiKeysManager } from './api-keys-manager';

/**
 * Phase 11 — API key settings. Any member may mint and manage their own
 * PERSONAL keys; ADMIN+ may additionally manage ORGANIZATION-wide keys. The
 * list shows every org key plus the caller's personal keys (enforced in the
 * service).
 */
export const dynamic = 'force-dynamic';

export default async function ApiKeysSettingsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const keys = await listApiKeysService();
  const canManageOrgKeys = roleSatisfies(active.role, ROLES.ADMIN);

  return <ApiKeysManager initialKeys={keys} canManageOrgKeys={canManageOrgKeys} />;
}
