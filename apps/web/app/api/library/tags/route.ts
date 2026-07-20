import { createTagSchema } from '@bond-os/shared';

import { createTagService, listTagsService } from '@/features/library/services/tag.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async () => {
  const organizationId = await requireActiveOrganizationId();
  const tags = await listTagsService(organizationId);
  return apiSuccess(tags);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createTagSchema);
  const tag = await createTagService(organizationId, body);
  return apiSuccess(tag, { status: 201 });
});
