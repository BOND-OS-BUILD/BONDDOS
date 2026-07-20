import { requireAuth } from '@bond-os/auth';
import { createDocumentMetadataSchema, documentQuerySchema, ValidationError } from '@bond-os/shared';

import { createDocumentService, listDocumentsService } from '@/features/documents/services/document.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, documentQuerySchema);
  const result = await listDocumentsService(organizationId, query);
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
  if (file.size > MAX_FILE_SIZE) {
    throw new ValidationError('File must be smaller than 20MB.');
  }

  // FormData has no native array encoding — `taskIds` is accepted as repeated
  // `taskIds` entries (formData.getAll) rather than deferring task-linking to
  // a later PATCH, since the client can just append the field multiple times.
  const rawFields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key === 'file' || key === 'taskIds' || typeof value !== 'string') continue;
    rawFields[key] = value;
  }
  const taskIds = formData.getAll('taskIds').filter((value): value is string => typeof value === 'string');
  const metadata = createDocumentMetadataSchema.parse({ ...rawFields, taskIds });

  const document = await createDocumentService(organizationId, user.id, metadata, file);
  return apiSuccess(document, { status: 201 });
});
