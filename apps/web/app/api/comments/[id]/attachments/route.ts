import { requireAuth } from '@bond-os/auth';
import { ValidationError } from '@bond-os/shared';

import { addCommentAttachmentService } from '@/features/comments/services/comment.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    throw new ValidationError('A file is required.');
  }

  const attachment = await addCommentAttachmentService(organizationId, user.id, id, file);
  return apiSuccess(attachment, { status: 201 });
});
