import { requireAuth } from '@bond-os/auth';
import { updateSpaceSchema } from '@bond-os/shared';

import { deleteSpaceService, getSpaceService, updateSpaceService } from '@/features/spaces/services/space.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const space = await getSpaceService(organizationId, id);
  return apiSuccess(space);
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, updateSpaceSchema);
  const space = await updateSpaceService(organizationId, user.id, id, body);
  return apiSuccess(space);
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  await deleteSpaceService(organizationId, user.id, id);
  return apiSuccess({ id });
});
