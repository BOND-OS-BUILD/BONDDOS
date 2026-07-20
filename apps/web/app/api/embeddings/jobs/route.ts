import { embeddingJobQuerySchema } from '@bond-os/shared';

import { listEmbeddingJobsService } from '@/features/embeddings/services/embedding-pipeline.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, embeddingJobQuerySchema);
  const result = await listEmbeddingJobsService(organizationId, {
    page: query.page,
    pageSize: query.pageSize,
    status: query.status,
  });
  return apiSuccess(result);
});
