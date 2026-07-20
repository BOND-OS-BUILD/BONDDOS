import { requireRole } from '@bond-os/auth';
import { prisma } from '@bond-os/database';
import { addMemberSchema, ConflictError, ForbiddenError, NotFoundError, ROLES } from '@bond-os/shared';

import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string }> };

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

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  await requireRole(id, ROLES.MEMBER);

  const memberships = await prisma.membership.findMany({
    where: { organizationId: id },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });

  return apiSuccess(memberships.map(toMemberDto));
});

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const { membership: requesterMembership } = await requireRole(id, ROLES.ADMIN);
  const body = await parseJsonBody(request, addMemberSchema);

  if (body.role === ROLES.OWNER && requesterMembership.role !== ROLES.OWNER) {
    throw new ForbiddenError('Only an owner can grant ownership.');
  }

  const targetUser = await prisma.user.findUnique({ where: { email: body.email } });
  if (!targetUser) {
    throw new NotFoundError('No account found for that email — they need to sign up first.');
  }

  const existing = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: targetUser.id, organizationId: id } },
  });
  if (existing) {
    throw new ConflictError('This user is already a member.');
  }

  const membership = await prisma.membership.create({
    data: { userId: targetUser.id, organizationId: id, role: body.role },
    include: { user: true },
  });

  return apiSuccess(toMemberDto(membership), { status: 201 });
});
