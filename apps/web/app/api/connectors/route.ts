import { requireAuth } from '@bond-os/auth';
import { connectConnectorSchema } from '@bond-os/shared';

import { connectConnectorService, listConnectorsService } from '@/features/connectors/services/connector.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async () => {
  const organizationId = await requireActiveOrganizationId();
  const result = await listConnectorsService(organizationId);
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, connectConnectorSchema);
  const connector = await connectConnectorService(organizationId, user.id, body.provider);
  return apiSuccess(connector, { status: 201 });
});
