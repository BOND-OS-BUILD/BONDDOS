import { updateProjectSchema } from '@bond-os/shared';

import {
  deleteProjectService,
  getProjectService,
  updateProjectService,
} from '@/features/projects/services/project.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const project = await getProjectService(organizationId, id);
  return apiSuccess(project);
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, updateProjectSchema);
  const project = await updateProjectService(organizationId, id, body);
  return apiSuccess(project);
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  await deleteProjectService(organizationId, id);
  return apiSuccess({ id });
});
