import { errorGroupQuerySchema, resolveErrorGroupSchema } from '@bond-os/shared';

import { listErrorGroupsService, resolveErrorGroupService } from '@/features/errors/services/error-reporting.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/** Phase 10 — platform-admin error console (grouped errors + resolve). */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async (request) => {
  const query = parseQueryParams(request, errorGroupQuerySchema);
  return apiSuccess(await listErrorGroupsService(query));
});

export const PATCH = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, resolveErrorGroupSchema);
  await resolveErrorGroupService(body);
  return apiSuccess({ updated: true });
});
