import { updateFolderSchema } from '@bond-os/shared';

import { deleteFolderService, renameFolderService } from '@/features/library/services/folder.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, updateFolderSchema);
  await renameFolderService(organizationId, id, body.name);
  return apiSuccess({ id });
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  await deleteFolderService(organizationId, id);
  return apiSuccess({ id });
});
