import 'server-only';

import { getMembership } from '@bond-os/database';
import { AuthError, ForbiddenError, type Role, roleSatisfies } from '@bond-os/shared';
import { headers } from 'next/headers';

import { getAuth, type Auth } from './server';

export type Session = Awaited<ReturnType<Auth['api']['getSession']>>;

/** The current request's session, or `null` if unauthenticated. Safe to call anywhere on the server. */
export async function getServerSession(): Promise<Session> {
  return getAuth().api.getSession({ headers: await headers() });
}

/** Returns the current session, or throws `AuthError` (401) if there isn't one. */
export async function requireAuth() {
  const session = await getServerSession();
  if (!session) {
    throw new AuthError();
  }
  return session;
}

/**
 * Requires an authenticated user who holds at least `minimumRole` in
 * `organizationId`. Throws `AuthError` if unauthenticated, `ForbiddenError`
 * if the user isn't a member or doesn't meet the role bar.
 */
export async function requireRole(organizationId: string, minimumRole: Role) {
  const session = await requireAuth();
  const membership = await getMembership(session.user.id, organizationId);

  if (!membership || !roleSatisfies(membership.role, minimumRole)) {
    throw new ForbiddenError();
  }

  return { session, membership };
}
