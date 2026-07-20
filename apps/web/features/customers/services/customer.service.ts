import { requireRole } from '@bond-os/auth';
import {
  createCustomer as createCustomerRow,
  deleteCustomer as deleteCustomerRow,
  getCustomerById,
  listCustomers,
  prisma,
  updateCustomer as updateCustomerRow,
  type CustomerDetail,
  type CustomerListItem,
} from '@bond-os/database';
import {
  NotFoundError,
  ROLES,
  ValidationError,
  type CreateCustomerInput,
  type CustomerQuery,
  type PaginatedResult,
  type UpdateCustomerInput,
} from '@bond-os/shared';

/** Dynamically imported, not statically — kept consistent with every other curated `publishEvent()` call site (see `apps/web/features/tasks/services/task.service.ts`) even where no `*.tool.ts` currently creates a cycle through this file, so a future tool added here doesn't silently reintroduce one. */
async function getPublishEvent() {
  const { publishEvent } = await import('@/features/workflows/services/event-bus.service');
  return publishEvent;
}

export async function listCustomersService(
  organizationId: string,
  query: CustomerQuery,
): Promise<PaginatedResult<CustomerListItem>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listCustomers({ organizationId, ...query });
}

export async function getCustomerService(organizationId: string, id: string): Promise<CustomerDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  const customer = await getCustomerById(id, organizationId);
  if (!customer) throw new NotFoundError('Customer not found.');
  return customer;
}

async function assertProjectsInOrg(organizationId: string, projectIds: string[]) {
  const uniqueIds = Array.from(new Set(projectIds));
  if (uniqueIds.length === 0) return;

  const count = await prisma.project.count({
    where: { id: { in: uniqueIds }, organizationId },
  });

  if (count !== uniqueIds.length) {
    throw new ValidationError('Projects must belong to your organization.');
  }
}

export async function createCustomerService(
  organizationId: string,
  input: CreateCustomerInput,
): Promise<CustomerDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  await assertProjectsInOrg(organizationId, input.projectIds);

  const created = await createCustomerRow({ organizationId, ...input });
  const publishEvent = await getPublishEvent();
  await publishEvent({
    organizationId,
    eventType: 'customer.created',
    source: 'CUSTOMER',
    payload: { customerId: created.id, name: created.name },
    entityType: 'CUSTOMER',
    entityId: created.id,
  });
  return created;
}

export async function updateCustomerService(
  organizationId: string,
  id: string,
  input: UpdateCustomerInput,
): Promise<CustomerDetail> {
  await requireRole(organizationId, ROLES.MEMBER);
  await assertProjectsInOrg(organizationId, input.projectIds ?? []);

  const updated = await updateCustomerRow(id, organizationId, input);
  if (!updated) throw new NotFoundError('Customer not found.');
  return updated;
}

export async function deleteCustomerService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const deleted = await deleteCustomerRow(id, organizationId);
  if (!deleted) throw new NotFoundError('Customer not found.');
}
