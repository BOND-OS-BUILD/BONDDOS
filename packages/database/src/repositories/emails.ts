import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { EmailDirection, Prisma } from '../generated/index.js';

export interface EmailListFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  search?: string;
  sortBy: 'subject' | 'sentAt' | 'createdAt';
  sortDir: 'asc' | 'desc';
  direction?: EmailDirection;
  customerId?: string;
  projectId?: string;
}

export interface EmailListItem {
  id: string;
  organizationId: string;
  subject: string;
  sender: string;
  recipient: string;
  sentAt: Date;
  direction: EmailDirection;
  createdAt: Date;
  customer: { id: string; name: string };
  project: { id: string; title: string } | null;
}

const listInclude = {
  customer: { select: { id: true, name: true } },
  project: { select: { id: true, title: true } },
} satisfies Prisma.EmailInclude;

type EmailWithRelations = Prisma.EmailGetPayload<{ include: typeof listInclude }>;

function toListItem(email: EmailWithRelations): EmailListItem {
  return {
    id: email.id,
    organizationId: email.organizationId,
    subject: email.subject,
    sender: email.sender,
    recipient: email.recipient,
    sentAt: email.sentAt,
    direction: email.direction,
    createdAt: email.createdAt,
    customer: email.customer,
    project: email.project,
  };
}

export async function listEmails(filters: EmailListFilters): Promise<PaginatedResult<EmailListItem>> {
  const { organizationId, page, pageSize, search, sortBy, sortDir, direction, customerId, projectId } = filters;

  const where: Prisma.EmailWhereInput = {
    organizationId,
    ...(direction && { direction }),
    ...(customerId && { customerId }),
    ...(projectId && { projectId }),
    ...(search && { subject: { contains: search, mode: 'insensitive' } }),
  };

  const [items, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: listInclude,
    }),
    prisma.email.count({ where }),
  ]);

  return {
    items: items.map(toListItem),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface CreateEmailData {
  organizationId: string;
  customerId: string;
  projectId?: string | null;
  subject: string;
  sender: string;
  recipient: string;
  sentAt: Date;
  direction: EmailDirection;
}

export async function createEmail(data: CreateEmailData): Promise<EmailListItem> {
  const email = await prisma.email.create({ data, include: listInclude });
  return toListItem(email);
}

export interface UpdateEmailData {
  customerId?: string;
  projectId?: string | null;
  subject?: string;
  sender?: string;
  recipient?: string;
  sentAt?: Date;
  direction?: EmailDirection;
}

/**
 * Updates an email, scoped to `organizationId` via `updateMany` (Prisma's
 * unique-`update` can't combine `id` with a non-unique `organizationId`
 * filter). Returns the refreshed row only if the scoped update matched one.
 */
export async function updateEmail(
  id: string,
  organizationId: string,
  data: UpdateEmailData,
): Promise<EmailListItem | null> {
  const result = await prisma.email.updateMany({ where: { id, organizationId }, data });
  if (result.count === 0) return null;

  const email = await prisma.email.findUnique({ where: { id }, include: listInclude });
  return email ? toListItem(email) : null;
}

export async function deleteEmail(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.email.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
