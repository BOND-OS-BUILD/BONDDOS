import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';

import { listTemplatesService } from '@/features/templates/services/template.service';
import { getActiveOrganization } from '@/lib/organization';

import { TemplatesManager } from './templates-manager';

export const dynamic = 'force-dynamic';

export default async function TemplatesPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);
  if (!active) redirect(ROUTES.dashboard);

  const templates = await listTemplatesService();
  return <TemplatesManager initialTemplates={templates} canManage={roleSatisfies(active.role, ROLES.ADMIN)} />;
}
