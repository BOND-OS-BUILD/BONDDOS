import { activityFeedQuerySchema } from '@bond-os/shared';

import { listActivityFeedService } from '@/features/activity/services/activity.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Organization Activity Feed (Phase 9). See docs/activity-feed.md. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, activityFeedQuerySchema);
  const result = await listActivityFeedService(organizationId, query);
  return apiSuccess(result);
});
