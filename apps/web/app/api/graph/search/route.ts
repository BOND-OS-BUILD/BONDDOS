import { graphSearchQuerySchema } from '@bond-os/shared';

import { searchGraphService } from '@/features/graph/services/graph.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Graph-page-specific search: entities (Phase 2's FTS) plus relationships and timeline events, which the main /api/search doesn't cover. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const { q } = parseQueryParams(request, graphSearchQuerySchema);
  const results = await searchGraphService(organizationId, q);
  return apiSuccess(results);
});
