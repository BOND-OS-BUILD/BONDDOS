import { retrievalDocumentQuerySchema } from '@bond-os/shared';

import { getDocumentRetrievalInfoService } from '@/features/retrieval/services/document-info.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, retrievalDocumentQuerySchema);
  const result = await getDocumentRetrievalInfoService(organizationId, query.id);
  return apiSuccess(result);
});
