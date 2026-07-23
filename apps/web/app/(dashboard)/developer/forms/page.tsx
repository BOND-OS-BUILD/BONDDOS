import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';

import { listCustomObjectsService } from '@/features/custom-objects/services/custom-object.service';
import { listFormsService } from '@/features/forms/services/form.service';
import { getActiveOrganization } from '@/lib/organization';

import { FormsManager } from './forms-manager';

export const dynamic = 'force-dynamic';

export default async function FormsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);
  if (!active) redirect(ROUTES.dashboard);

  const [forms, objects] = await Promise.all([listFormsService(), listCustomObjectsService()]);
  return (
    <FormsManager
      initialForms={forms}
      objectOptions={objects.map((object) => ({ key: object.key, name: object.name }))}
      canManage={roleSatisfies(active.role, ROLES.ADMIN)}
    />
  );
}
