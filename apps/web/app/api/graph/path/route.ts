import { pathQuerySchema } from '@bond-os/shared';

import { findShortestPathService } from '@/features/graph/services/graph.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Shortest path (bounded BFS) between two entities. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const { from, to } = parseQueryParams(request, pathQuerySchema);
  const path = await findShortestPathService(organizationId, from, to);
  return apiSuccess({ path });
});
