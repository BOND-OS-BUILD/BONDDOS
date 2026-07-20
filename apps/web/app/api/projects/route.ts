import { createProjectSchema, projectQuerySchema } from '@bond-os/shared';

import { createProjectService, listProjectsService } from '@/features/projects/services/project.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, projectQuerySchema);
  const result = await listProjectsService(organizationId, query);
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createProjectSchema);
  const project = await createProjectService(organizationId, body);
  return apiSuccess(project, { status: 201 });
});
