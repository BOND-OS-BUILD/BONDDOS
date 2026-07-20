import { requireAuth } from '@bond-os/auth';
import { createKnowledgeDocumentMetadataSchema, knowledgeDocumentQuerySchema, ValidationError } from '@bond-os/shared';

import {
  createKnowledgeDocumentService,
  listKnowledgeDocumentsService,
} from '@/features/library/services/library.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, knowledgeDocumentQuerySchema);
  const result = await listKnowledgeDocumentsService(organizationId, query);
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();

  const formData = await request.formData();
  const file = formData.get('file');
  if (!file || typeof file === 'string') {
    throw new ValidationError('A file is required.');
  }

  const rawFields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key === 'file' || key === 'tagIds' || typeof value !== 'string') continue;
    rawFields[key] = value;
  }
  const tagIds = formData.getAll('tagIds').filter((value): value is string => typeof value === 'string');
  const metadata = createKnowledgeDocumentMetadataSchema.parse({ ...rawFields, tagIds });

  const document = await createKnowledgeDocumentService(organizationId, user.id, metadata, file);
  return apiSuccess(document, { status: 201 });
});
