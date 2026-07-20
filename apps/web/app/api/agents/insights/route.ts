import { insightListQuerySchema } from '@bond-os/shared';

import { getInsightService } from '@/features/agents/lib/container';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** The Insight Engine's read side — Risks, Missing Information, Conflicts, Duplicates, Recommendations. See docs/insights.md. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, insightListQuerySchema);
  const result = await getInsightService().list(organizationId, query);
  return apiSuccess(result);
});
