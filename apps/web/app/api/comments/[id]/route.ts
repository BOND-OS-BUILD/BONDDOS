import { requireAuth } from '@bond-os/auth';
import { updateCommentSchema } from '@bond-os/shared';

import { deleteCommentService, updateCommentService } from '@/features/comments/services/comment.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, updateCommentSchema);
  const comment = await updateCommentService(organizationId, user.id, id, body.content);
  return apiSuccess(comment);
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  await deleteCommentService(organizationId, user.id, id);
  return apiSuccess({ id });
});
