import { requireAuth } from '@bond-os/auth';
import { createFolderSchema } from '@bond-os/shared';

import { createFolderService, listFoldersService } from '@/features/library/services/folder.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async () => {
  const organizationId = await requireActiveOrganizationId();
  const folders = await listFoldersService(organizationId);
  return apiSuccess(folders);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createFolderSchema);
  const folder = await createFolderService(organizationId, user.id, body);
  return apiSuccess(folder, { status: 201 });
});
