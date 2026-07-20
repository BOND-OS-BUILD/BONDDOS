import { connectedEntitiesQuerySchema } from '@bond-os/shared';

import { findConnectedEntitiesService } from '@/features/graph/services/graph.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** Every entity reachable from this one within `maxDepth` hops — bounded BFS, see packages/database/src/repositories/graph.ts. */
export const GET = apiHandler<Context>(async (request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const { maxDepth } = parseQueryParams(request, connectedEntitiesQuerySchema);
  const connected = await findConnectedEntitiesService(organizationId, id, maxDepth);
  return apiSuccess(connected);
});
