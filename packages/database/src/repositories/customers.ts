import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { CustomerStatus, Prisma } from '../generated/index.js';

export interface CustomerListFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  search?: string;
  sortBy: 'name' | 'status' | 'createdAt';
  sortDir: 'asc' | 'desc';
  status?: CustomerStatus;
}

export interface CustomerListItem {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  status: CustomerStatus;
  notes: string | null;
  projectCount: number;
  emailCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CustomerDetail extends CustomerListItem {
  organizationId: string;
  projects: Array<{ id: string; title: string }>;
  emails: Array<{
    id: string;
    subject: string;
    sender: string;
    recipient: string;
    sentAt: Date;
    direction: string;
  }>;
}

const listInclude = {
  _count: { select: { projects: true, emails: true } },
} satisfies Prisma.CustomerInclude;

type CustomerWithCounts = Prisma.CustomerGetPayload<{ include: typeof listInclude }>;

function toListItem(customer: CustomerWithCounts): CustomerListItem {
  return {
    id: customer.id,
    name: customer.name,
    company: customer.company,
    email: customer.email,
    phone: customer.phone,
    website: customer.website,
    status: customer.status,
    notes: customer.notes,
    projectCount: customer._count.projects,
    emailCount: customer._count.emails,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

export async function listCustomers(filters: CustomerListFilters): Promise<PaginatedResult<CustomerListItem>> {
  const { organizationId, page, pageSize, search, sortBy, sortDir, status } = filters;

  const where: Prisma.CustomerWhereInput = {
    organizationId,
    ...(status && { status }),
    ...(search && { name: { contains: search, mode: 'insensitive' } }),
  };

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: listInclude,
    }),
    prisma.customer.count({ where }),
  ]);

  return {
    items: items.map(toListItem),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getCustomerById(id: string, organizationId: string): Promise<CustomerDetail | null> {
  const customer = await prisma.customer.findFirst({
    where: { id, organizationId },
    include: {
      ...listInclude,
      projects: {
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
      },
      emails: {
        select: { id: true, subject: true, sender: true, recipient: true, sentAt: true, direction: true },
        orderBy: { sentAt: 'desc' },
      },
    },
  });

  if (!customer) return null;

  return {
    ...toListItem(customer),
    organizationId: customer.organizationId,
    projects: customer.projects,
    emails: customer.emails,
  };
}

export interface CreateCustomerData {
  organizationId: string;
  name: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  status: CustomerStatus;
  notes?: string | null;
  projectIds: string[];
}

export async function createCustomer(data: CreateCustomerData): Promise<CustomerDetail> {
  const { projectIds, ...rest } = data;

  const customer = await prisma.customer.create({
    data: {
      ...rest,
      projects: { connect: projectIds.map((id) => ({ id })) },
    },
  });

  const detail = await getCustomerById(customer.id, customer.organizationId);
  if (!detail) throw new Error('Failed to load customer immediately after creation.');
  return detail;
}

export interface UpdateCustomerData {
  name?: string;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  status?: CustomerStatus;
  notes?: string | null;
  projectIds?: string[];
}

/**
 * Updates a customer, scoped to `organizationId` via `updateMany` for the
 * scalar fields (Prisma's unique-`update` can't combine `id` with a
 * non-unique `organizationId` filter). The implicit `projects` m2m `set`
 * only runs after the scoped `updateMany` confirms the row belongs to this
 * org, so a cross-tenant `id` can't sneak a relation mutation through — at
 * that point `prisma.customer.update({ where: { id } })`'s unique-`id`-only
 * `where` is safe to use directly.
 */
export async function updateCustomer(
  id: string,
  organizationId: string,
  data: UpdateCustomerData,
): Promise<CustomerDetail | null> {
  const { projectIds, ...rest } = data;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.customer.updateMany({ where: { id, organizationId }, data: rest });
    if (result.count === 0) return false;

    if (projectIds) {
      await tx.customer.update({
        where: { id },
        data: { projects: { set: projectIds.map((projectId) => ({ id: projectId })) } },
      });
    }

    return true;
  });

  if (!updated) return null;
  return getCustomerById(id, organizationId);
}

export async function deleteCustomer(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.customer.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
