import { deleteEmbeddingQuerySchema, generateEmbeddingSchema } from '@bond-os/shared';

import {
  deleteEmbeddingForSourceService,
  generateEmbeddingForSourceService,
} from '@/features/embeddings/services/embedding-pipeline.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, generateEmbeddingSchema);
  await generateEmbeddingForSourceService(organizationId, body);
  return apiSuccess({ sourceType: body.sourceType, sourceId: body.sourceId }, { status: 201 });
});

export const DELETE = apiHandler(async (request) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, deleteEmbeddingQuerySchema);
  await deleteEmbeddingForSourceService(organizationId, query.sourceType, query.sourceId);
  return apiSuccess({ sourceType: query.sourceType, sourceId: query.sourceId });
});
