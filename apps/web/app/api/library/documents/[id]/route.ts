import { updateKnowledgeDocumentSchema } from '@bond-os/shared';

import {
  deleteKnowledgeDocumentService,
  getKnowledgeDocumentService,
  updateKnowledgeDocumentService,
} from '@/features/library/services/library.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const document = await getKnowledgeDocumentService(organizationId, id);
  return apiSuccess(document);
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, updateKnowledgeDocumentSchema);
  const document = await updateKnowledgeDocumentService(organizationId, id, body);
  return apiSuccess(document);
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  await deleteKnowledgeDocumentService(organizationId, id);
  return apiSuccess({ id });
});
