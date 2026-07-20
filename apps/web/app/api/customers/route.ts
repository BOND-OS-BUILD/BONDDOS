import { createCustomerSchema, customerQuerySchema } from '@bond-os/shared';

import { createCustomerService, listCustomersService } from '@/features/customers/services/customer.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, customerQuerySchema);
  const result = await listCustomersService(organizationId, query);
  return apiSuccess(result);
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createCustomerSchema);
  const customer = await createCustomerService(organizationId, body);
  return apiSuccess(customer, { status: 201 });
});
