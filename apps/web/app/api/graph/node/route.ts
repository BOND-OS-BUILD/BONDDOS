import { nodeQuerySchema } from '@bond-os/shared';

import { getNeighborsService, getNodeService } from '@/features/graph/services/graph.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Light, visualization-oriented lookup: one node + its immediate neighbors, in one round trip — used by React Flow's expand-on-click. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const { type, id } = parseQueryParams(request, nodeQuerySchema);

  const [node, neighbors] = await Promise.all([
    getNodeService(organizationId, type, id),
    getNeighborsService(organizationId, id),
  ]);

  return apiSuccess({ node, neighbors });
});
