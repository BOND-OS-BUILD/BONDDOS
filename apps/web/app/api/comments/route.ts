import { requireAuth } from '@bond-os/auth';
import { commentListQuerySchema, createCommentSchema } from '@bond-os/shared';

import { createCommentService, listCommentsForEntityService } from '@/features/comments/services/comment.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Universal comments (Phase 9) — `?entityType=&entityId=` scopes to one entity's thread. See docs/comments.md. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, commentListQuerySchema);
  const result = await listCommentsForEntityService(organizationId, query.entityType, query.entityId, query.page, query.pageSize);
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createCommentSchema);
  const comment = await createCommentService(organizationId, user.id, body);
  return apiSuccess(comment, { status: 201 });
});
