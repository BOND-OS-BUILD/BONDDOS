import { rebuildVectorsService } from '@/features/embeddings/services/embedding-pipeline.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const result = await rebuildVectorsService(organizationId);
  return apiSuccess(result);
});
