import { retrievalCitationsQuerySchema } from '@bond-os/shared';

import { resolveCitationService } from '@/features/retrieval/services/citation.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, retrievalCitationsQuerySchema);
  const results = await Promise.allSettled(
    query.refs.map((ref) => resolveCitationService(organizationId, ref)),
  );
  const citations = results
    .map((result) => (result.status === 'fulfilled' ? result.value : null))
    .filter((citation) => citation !== null);
  return apiSuccess({ citations });
});
