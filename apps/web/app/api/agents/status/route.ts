import { getAgentStatusService } from '@/features/agents/services/agent-discovery.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Every registered agent's real `health()` — no fabricated uptime/metrics. */
export const GET = apiHandler(async () => {
  const organizationId = await requireActiveOrganizationId();
  const statuses = await getAgentStatusService(organizationId);
  return apiSuccess(statuses);
});
