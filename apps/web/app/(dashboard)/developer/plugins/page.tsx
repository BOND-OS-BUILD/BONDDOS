import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';

import { listPluginsService } from '@/features/plugins/services/plugin.service';
import { getActiveOrganization } from '@/lib/organization';

import { PluginsManager } from './plugins-manager';

export const dynamic = 'force-dynamic';

export default async function PluginsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);
  if (!active) redirect(ROUTES.dashboard);

  const plugins = await listPluginsService();
  return <PluginsManager initialPlugins={plugins} canManage={roleSatisfies(active.role, ROLES.ADMIN)} />;
}
