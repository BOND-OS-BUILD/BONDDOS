'use server';

import { getOrganizationsForUser } from '@bond-os/database';
import { requireAuth } from '@bond-os/auth';
import { cookies } from 'next/headers';

import { ACTIVE_ORG_COOKIE } from '@/lib/organization';

/**
 * Switches the caller's active organization (org switcher in the topbar).
 * `organizationId` is only ever matched against the caller's own
 * memberships — an id for an org they don't belong to is silently ignored.
 */
export async function setActiveOrganization(organizationId: string): Promise<void> {
  const session = await requireAuth();
  const organizations = await getOrganizationsForUser(session.user.id);

  if (!organizations.some((org) => org.id === organizationId)) {
    return;
  }

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_ORG_COOKIE, organizationId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}
