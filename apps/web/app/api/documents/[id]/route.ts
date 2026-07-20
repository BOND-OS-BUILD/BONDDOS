import { updateDocumentSchema } from '@bond-os/shared';

import {
  deleteDocumentService,
  getDocumentService,
  updateDocumentService,
} from '@/features/documents/services/document.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const document = await getDocumentService(organizationId, id);
  return apiSuccess(document);
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, updateDocumentSchema);
  const document = await updateDocumentService(organizationId, id, body);
  return apiSuccess(document);
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  await deleteDocumentService(organizationId, id);
  return apiSuccess({ id });
});
