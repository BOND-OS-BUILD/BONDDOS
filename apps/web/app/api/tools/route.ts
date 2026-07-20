import { listToolsService } from '@/features/tools/services/tool-discovery.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Tool Discovery (spec: "AI must never hardcode tool names."). See docs/tool-execution.md. */
export const GET = apiHandler(async () => {
  const organizationId = await requireActiveOrganizationId();
  const tools = await listToolsService(organizationId);
  return apiSuccess(tools);
});
