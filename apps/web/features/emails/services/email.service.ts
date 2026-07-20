import { requireRole } from '@bond-os/auth';
import {
  createEmail as createEmailRow,
  deleteEmail as deleteEmailRow,
  listEmails,
  prisma,
  updateEmail as updateEmailRow,
  type EmailListItem,
} from '@bond-os/database';
import {
  NotFoundError,
  ROLES,
  type CreateEmailInput,
  type EmailQuery,
  type PaginatedResult,
  type UpdateEmailInput,
} from '@bond-os/shared';

export async function listEmailsService(
  organizationId: string,
  query: EmailQuery,
): Promise<PaginatedResult<EmailListItem>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listEmails({ organizationId, ...query });
}

async function assertCustomerInOrg(organizationId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({ where: { id: customerId, organizationId } });
  if (!customer) throw new NotFoundError('Customer not found.');
}

async function assertProjectInOrg(organizationId: string, projectId: string) {
  const project = await prisma.project.findFirst({ where: { id: projectId, organizationId } });
  if (!project) throw new NotFoundError('Project not found.');
}

export async function createEmailService(
  organizationId: string,
  input: CreateEmailInput,
): Promise<EmailListItem> {
  await requireRole(organizationId, ROLES.MEMBER);
  await assertCustomerInOrg(organizationId, input.customerId);
  if (input.projectId) await assertProjectInOrg(organizationId, input.projectId);

  return createEmailRow({ organizationId, ...input });
}

export async function updateEmailService(
  organizationId: string,
  id: string,
  input: UpdateEmailInput,
): Promise<EmailListItem> {
  await requireRole(organizationId, ROLES.MEMBER);
  if (input.customerId) await assertCustomerInOrg(organizationId, input.customerId);
  if (input.projectId) await assertProjectInOrg(organizationId, input.projectId);

  const updated = await updateEmailRow(id, organizationId, input);
  if (!updated) throw new NotFoundError('Email not found.');
  return updated;
}

export async function deleteEmailService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const deleted = await deleteEmailRow(id, organizationId);
  if (!deleted) throw new NotFoundError('Email not found.');
}
