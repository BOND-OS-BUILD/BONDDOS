import { requireRole } from '@bond-os/auth';
import { prisma } from '@bond-os/database';
import { ForbiddenError, NotFoundError, ROLES, updateMemberRoleSchema, ValidationError } from '@bond-os/shared';

import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string; userId: string }> };

interface MembershipWithUser {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: { name: string; email: string; image: string | null };
}

function toMemberDto(membership: MembershipWithUser) {
  return {
    membershipId: membership.id,
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    avatar: membership.user.image,
    role: membership.role,
    joinedAt: membership.createdAt.toISOString(),
  };
}

/** Throws unless the organization would still have at least one OWNER afterward. */
async function assertNotLastOwner(organizationId: string): Promise<void> {
  const ownerCount = await prisma.membership.count({
    where: { organizationId, role: 'OWNER' },
  });
  if (ownerCount <= 1) {
    throw new ValidationError('An organization must have at least one owner.');
  }
}

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id, userId } = await params;
  const { membership: requesterMembership } = await requireRole(id, ROLES.ADMIN);
  const body = await parseJsonBody(request, updateMemberRoleSchema);

  const target = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: id } },
    include: { user: true },
  });
  if (!target) {
    throw new NotFoundError('Membership not found.');
  }

  const requesterIsOwner = requesterMembership.role === ROLES.OWNER;

  // Only an OWNER may touch a currently-OWNER membership or grant ownership.
  if ((target.role === ROLES.OWNER || body.role === ROLES.OWNER) && !requesterIsOwner) {
    throw new ForbiddenError('Only an owner can modify an owner membership or grant ownership.');
  }

  if (target.role === ROLES.OWNER && body.role !== ROLES.OWNER) {
    await assertNotLastOwner(id);
  }

  const updated = await prisma.membership.update({
    where: { userId_organizationId: { userId, organizationId: id } },
    data: { role: body.role },
    include: { user: true },
  });

  return apiSuccess(toMemberDto(updated));
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id, userId } = await params;
  const { membership: requesterMembership } = await requireRole(id, ROLES.ADMIN);

  const target = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: id } },
  });
  if (!target) {
    throw new NotFoundError('Membership not found.');
  }

  if (target.role === ROLES.OWNER && requesterMembership.role !== ROLES.OWNER) {
    throw new ForbiddenError('Only an owner can remove an owner.');
  }

  if (target.role === ROLES.OWNER) {
    await assertNotLastOwner(id);
  }

  await prisma.membership.delete({
    where: { userId_organizationId: { userId, organizationId: id } },
  });

  return apiSuccess({ removed: true });
});
