import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';

import { listCustomObjectsService } from '@/features/custom-objects/services/custom-object.service';
import { getActiveOrganization } from '@/lib/organization';

import { ObjectsManager } from './objects-manager';

export const dynamic = 'force-dynamic';

export default async function CustomObjectsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);
  if (!active) redirect(ROUTES.dashboard);

  const objects = await listCustomObjectsService();
  return <ObjectsManager initialObjects={objects} canManage={roleSatisfies(active.role, ROLES.ADMIN)} />;
}
