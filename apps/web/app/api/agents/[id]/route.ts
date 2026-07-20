import { NotFoundError } from '@bond-os/shared';

import { getAgentService } from '@/features/agents/services/agent-discovery.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

/** `[id]` is actually an `agentKey`, not a database id — the registry has no separate row id for this lookup. */
export const GET = apiHandler<Context>(async (_request, { params }) => {
  const organizationId = await requireActiveOrganizationId();
  const { id: agentKey } = await params;

  const agent = await getAgentService(organizationId, agentKey);
  if (!agent) throw new NotFoundError(`Agent not found: ${agentKey}`);

  return apiSuccess(agent);
});
