import { listAgentsService } from '@/features/agents/services/agent-discovery.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Agent Discovery — the live registry, mapped to a plain serializable shape. See docs/agent-registry.md. */
export const GET = apiHandler(async () => {
  const organizationId = await requireActiveOrganizationId();
  const agents = await listAgentsService(organizationId);
  return apiSuccess(agents);
});
