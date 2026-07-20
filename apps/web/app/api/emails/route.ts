import { createEmailSchema, emailQuerySchema } from '@bond-os/shared';

import { createEmailService, listEmailsService } from '@/features/emails/services/email.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, emailQuerySchema);
  const result = await listEmailsService(organizationId, query);
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createEmailSchema);
  const email = await createEmailService(organizationId, body);
  return apiSuccess(email, { status: 201 });
});
