import { createTaskSchema, taskQuerySchema } from '@bond-os/shared';

import { createTaskService, listTasksService } from '@/features/tasks/services/task.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, taskQuerySchema);
  const result = await listTasksService(organizationId, query);
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createTaskSchema);
  const task = await createTaskService(organizationId, body);
  return apiSuccess(task, { status: 201 });
});
