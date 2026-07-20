import { triggerSyncService } from '@/features/sync/services/sync.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const job = await triggerSyncService(organizationId, id);
  return apiSuccess(job);
});
