import { requireAuth } from '@bond-os/auth';
import { createSpaceSchema, spaceListQuerySchema } from '@bond-os/shared';

import { createSpaceService, listSpacesService } from '@/features/spaces/services/space.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Team Spaces (Phase 9) — curation and grouping, not a parallel ACL. See docs/spaces.md. */
export const GET = apiHandler(async (request) => {
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, spaceListQuerySchema);
  const result = await listSpacesService(organizationId, user.id, query.page, query.pageSize, query.mine);
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createSpaceSchema);
  const space = await createSpaceService(organizationId, user.id, body);
  return apiSuccess(space, { status: 201 });
});
