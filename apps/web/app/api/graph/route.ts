import { getGraphAnalyticsService } from '@/features/graph/services/graph.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Analytics/overview — dashboard cards for the /graph page (totals, top-connected, recent, breakdown, growth). */
export const GET = apiHandler(async () => {
  const organizationId = await requireActiveOrganizationId();
  const analytics = await getGraphAnalyticsService(organizationId);
  return apiSuccess(analytics);
});
