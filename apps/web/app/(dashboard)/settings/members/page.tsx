import { redirect } from 'next/navigation';

import { requireAuth } from '@bond-os/auth';
import { prisma } from '@bond-os/database';
import { ROLES, ROUTES, roleSatisfies } from '@bond-os/shared';

import { getActiveOrganization } from '@/lib/organization';

import { MembersTable, type MemberDto } from './members-table';

export default async function MembersSettingsPage() {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);

  if (!active) {
    redirect(ROUTES.dashboard);
  }

  const memberships = await prisma.membership.findMany({
    where: { organizationId: active.id },
    include: { user: true },
    orderBy: { createdAt: 'asc' },
  });

  const members: MemberDto[] = memberships.map((membership) => ({
    membershipId: membership.id,
    userId: membership.userId,
    name: membership.user.name,
    email: membership.user.email,
    avatar: membership.user.image,
    role: membership.role,
    joinedAt: membership.createdAt.toISOString(),
  }));

  const canManage = roleSatisfies(active.role, ROLES.ADMIN);

  return (
    <MembersTable
      organizationId={active.id}
      initialMembers={members}
      canManage={canManage}
      callerRole={active.role}
      currentUserId={session.user.id}
    />
  );
}
