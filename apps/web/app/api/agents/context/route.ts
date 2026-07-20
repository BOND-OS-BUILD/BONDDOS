import { agentContextQuerySchema } from '@bond-os/shared';

import { previewAgentContextService } from '@/features/agents/services/agent-context-preview.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Introspection only — shows what a real turn would retrieve/prompt with, without ever calling the AI provider. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, agentContextQuerySchema);
  const preview = await previewAgentContextService(organizationId, query);
  return apiSuccess(preview);
});
