import { notFound, redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { isAppError, ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';

import {
  getCustomObjectService,
  listCustomRecordsService,
} from '@/features/custom-objects/services/custom-object.service';
import { getActiveOrganization } from '@/lib/organization';

import { RecordsManager } from './records-manager';

export const dynamic = 'force-dynamic';

export default async function CustomObjectDetailPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);
  if (!active) redirect(ROUTES.dashboard);

  try {
    const object = await getCustomObjectService(key);
    const records = await listCustomRecordsService(key, { pageSize: 50 });
    return (
      <RecordsManager
        objectKey={key}
        objectName={object.name}
        fields={object.fields}
        initialRecords={records.items}
        canManage={roleSatisfies(active.role, ROLES.ADMIN)}
      />
    );
  } catch (error) {
    if (isAppError(error) && error.statusCode === 404) notFound();
    throw error;
  }
}
