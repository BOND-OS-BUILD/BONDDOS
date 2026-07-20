import { updateCustomerSchema } from '@bond-os/shared';

import {
  deleteCustomerService,
  getCustomerService,
  updateCustomerService,
} from '@/features/customers/services/customer.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

type Context = { params: Promise<{ id: string }> };

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const customer = await getCustomerService(organizationId, id);
  return apiSuccess(customer);
});

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, updateCustomerSchema);
  const customer = await updateCustomerService(organizationId, id, body);
  return apiSuccess(customer);
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  await deleteCustomerService(organizationId, id);
  return apiSuccess({ id });
});
