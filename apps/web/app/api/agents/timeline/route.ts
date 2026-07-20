import { agentTimelineQuerySchema } from '@bond-os/shared';

import { getAgentTimelineService } from '@/features/agents/lib/container';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * Not in the original spec's enumerated endpoint list, but required: this is
 * what the Delegation Graph UI queries against `AgentTimelineEvent` with
 * `eventType=DELEGATION` to render the live delegation graph. See docs/delegation.md.
 */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, agentTimelineQuerySchema);
  const result = await getAgentTimelineService().list(organizationId, query);
  return apiSuccess(result);
});
