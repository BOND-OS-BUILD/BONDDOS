import { timelineQuerySchema } from '@bond-os/shared';

import { getOrganizationTimelineService, getTimelineService } from '@/features/graph/services/graph.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** One entity's activity feed (entityId set) or the org-wide feed (entityId omitted) — backs the Timeline page. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const { entityId, page, pageSize } = parseQueryParams(request, timelineQuerySchema);

  const result = entityId
    ? await getTimelineService(organizationId, entityId, { page, pageSize })
    : await getOrganizationTimelineService(organizationId, { page, pageSize });

  return apiSuccess(result);
});
