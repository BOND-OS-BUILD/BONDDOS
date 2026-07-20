import { disconnectConnectorService } from '@/features/connectors/services/connector.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  await disconnectConnectorService(organizationId, id);
  return apiSuccess({ id });
});
