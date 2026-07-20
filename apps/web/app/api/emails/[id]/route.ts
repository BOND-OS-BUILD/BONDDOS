import { updateEmailSchema } from '@bond-os/shared';

import { deleteEmailService, updateEmailService } from '@/features/emails/services/email.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, updateEmailSchema);
  const email = await updateEmailService(organizationId, id, body);
  return apiSuccess(email);
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  await deleteEmailService(organizationId, id);
  return apiSuccess({ id });
});
