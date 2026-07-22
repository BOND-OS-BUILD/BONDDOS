import { requireAuth } from '@bond-os/auth';
import { getOrganizationsForUser, type OrganizationForUser } from '@bond-os/database';
import { AuthError } from '@bond-os/shared';
import { updateRequestContext } from '@bond-os/shared/server';
import { cookies } from 'next/headers';

export const ACTIVE_ORG_COOKIE = 'bondos_active_org';

export interface ActiveOrganizationResult {
  organizations: OrganizationForUser[];
  /** The user's currently-selected organization, or `null` if they belong to none yet. */
  active: OrganizationForUser | null;
}

/**
 * Resolves the caller's organizations plus which one is "active" (from the
 * `bondos_active_org` cookie, falling back to their first membership).
 * Tampering with the cookie is harmless — the value is only ever matched
 * against the user's own memberships, never trusted directly.
 */
export async function getActiveOrganization(userId: string): Promise<ActiveOrganizationResult> {
  const organizations = await getOrganizationsForUser(userId);
  if (organizations.length === 0) {
    return { organizations, active: null };
  }

  const cookieStore = await cookies();
  const activeId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const active = organizations.find((org) => org.id === activeId) ?? organizations[0]!;

  return { organizations, active };
}

/**
 * Resolves the caller's active organization id inside a Route Handler.
 * Throws `AuthError` if unauthenticated, or a `NotFoundError`-shaped
 * `AuthError` (via `ForbiddenError` upstream in `requireRole`) is not
 * needed here — a user with zero organizations simply can't have an active
 * one, which every Knowledge Graph entity requires, so this throws
 * `AuthError` in that case too (the client should already be routing them
 * through onboarding before hitting these endpoints).
 */
export async function requireActiveOrganizationId(): Promise<string> {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);
  if (!active) {
    throw new AuthError('No active organization. Create or join an organization first.');
  }
  updateRequestContext({ organizationId: active.id });
  return active.id;
}
