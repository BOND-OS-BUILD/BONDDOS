import { prisma } from '../client';
import type { Role } from '../generated/index.js';
import { toUserSummary, userSummarySelect, type UserSummary } from '../repositories/shared';

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  ownerId: string;
}

/**
 * Creates an organization together with its single auto-provisioned
 * Workspace and an OWNER membership for the creating user, atomically.
 * Shared by the `/api/organization` route handler and the seed script so
 * the "every organization gets a workspace" invariant lives in one place.
 */
export async function createOrganizationWithWorkspace(input: CreateOrganizationInput) {
  return prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({
      data: { name: input.name, slug: input.slug },
    });

    await tx.workspace.create({
      data: { organizationId: organization.id },
    });

    await tx.membership.create({
      data: { userId: input.ownerId, organizationId: organization.id, role: 'OWNER' },
    });

    return organization;
  });
}

export interface OrganizationForUser {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  role: Role;
}

/** All organizations `userId` belongs to, with their role in each. */
export async function getOrganizationsForUser(userId: string): Promise<OrganizationForUser[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { organization: true },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((membership) => ({
    id: membership.organization.id,
    name: membership.organization.name,
    slug: membership.organization.slug,
    logo: membership.organization.logo,
    role: membership.role,
  }));
}

/** The caller's membership (and therefore role) for a given organization, or null. */
export function getMembership(userId: string, organizationId: string) {
  return prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId } },
  });
}

/** The full organization record (including the Phase 1 business-profile fields), or null. */
export function getOrganizationById(id: string) {
  return prisma.organization.findUnique({ where: { id } });
}

export interface OrganizationStats {
  members: number;
  projects: number;
  tasks: number;
  documents: number;
  meetings: number;
  customers: number;
}

/** Live counts of everything attached to an organization — powers the /company profile page. */
export async function getOrganizationStats(organizationId: string): Promise<OrganizationStats> {
  const [members, projects, tasks, documents, meetings, customers] = await Promise.all([
    prisma.membership.count({ where: { organizationId } }),
    prisma.project.count({ where: { organizationId } }),
    prisma.task.count({ where: { organizationId } }),
    prisma.document.count({ where: { organizationId } }),
    prisma.meeting.count({ where: { organizationId } }),
    prisma.customer.count({ where: { organizationId } }),
  ]);

  return { members, projects, tasks, documents, meetings, customers };
}

/**
 * Every member of an organization, as `UserSummary`s — used to populate
 * owner/assignee/attendee/member pickers across every Knowledge Graph
 * entity's create/edit forms.
 */
export async function getOrganizationMembers(organizationId: string): Promise<UserSummary[]> {
  const memberships = await prisma.membership.findMany({
    where: { organizationId },
    include: { user: { select: userSummarySelect } },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((membership) => toUserSummary(membership.user));
}

/** Members holding any of `roles` — used by Phase 9's notification fan-out to reach org OWNER/ADMIN holders (e.g. for `insight.created`) without a broadcast to every member. */
export async function getOrganizationMembersByRole(organizationId: string, roles: Role[]): Promise<UserSummary[]> {
  const memberships = await prisma.membership.findMany({
    where: { organizationId, role: { in: roles } },
    include: { user: { select: userSummarySelect } },
    orderBy: { createdAt: 'asc' },
  });

  return memberships.map((membership) => toUserSummary(membership.user));
}
