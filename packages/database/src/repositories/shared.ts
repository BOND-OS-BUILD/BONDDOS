import { prisma } from '../client';

/**
 * Cross-repository helpers. `UserSummary` is the shape every repository
 * uses for owner/assignee/uploader/attendee/member references — a single
 * definition keeps the `image` -> `avatar` DTO rename consistent everywhere
 * instead of every repository/service re-deriving it slightly differently.
 */
export const userSummarySelect = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

export function toUserSummary(user: { id: string; name: string; email: string; image: string | null }): UserSummary {
  return { id: user.id, name: user.name, email: user.email, avatar: user.image };
}

export function toUserSummaryOrNull(
  user: { id: string; name: string; email: string; image: string | null } | null | undefined,
): UserSummary | null {
  return user ? toUserSummary(user) : null;
}

/**
 * Returns true only if every id in `userIds` is a member of `organizationId`
 * — used to validate owner/assignee/member/attendee fields on create/update
 * so a caller can't wire an entity to a user outside their organization.
 * An empty `userIds` array is vacuously valid (nothing to check).
 */
export async function areAllUsersInOrganization(userIds: string[], organizationId: string): Promise<boolean> {
  const uniqueIds = Array.from(new Set(userIds));
  if (uniqueIds.length === 0) return true;

  const count = await prisma.membership.count({
    where: { organizationId, userId: { in: uniqueIds } },
  });

  return count === uniqueIds.length;
}

/** `true` only if every id in `spaceIds` is a real Space in `organizationId` — used to validate `@team` mention targets the same way `areAllUsersInOrganization` validates `@user` targets. */
export async function areAllSpacesInOrganization(spaceIds: string[], organizationId: string): Promise<boolean> {
  const uniqueIds = Array.from(new Set(spaceIds));
  if (uniqueIds.length === 0) return true;

  const count = await prisma.space.count({ where: { organizationId, id: { in: uniqueIds } } });
  return count === uniqueIds.length;
}
