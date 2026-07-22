import 'server-only';

import { isUserPlatformAdmin } from '@bond-os/database';
import { ForbiddenError } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';

import { getServerSession, requireAuth } from './session';

/**
 * Phase 10 — platform-administrator authorization. This is deliberately
 * DISTINCT from the org-scoped `Role` (OWNER/ADMIN/MEMBER): a platform admin
 * operates the whole deployment (the cross-org Admin Console), not a single
 * organization. There was no such concept in P0–P9.
 *
 * Two grant paths, checked in this order:
 *  1. The `PLATFORM_ADMIN_EMAILS` env allowlist (comma-separated) — the
 *     bootstrap path so the very first administrator needs no DB surgery.
 *  2. The `User.isPlatformAdmin` DB flag — the durable, in-app grant that a
 *     platform admin can toggle for others from the Admin Console.
 */

function platformAdminAllowlist(): string[] {
  const raw = getEnv().PLATFORM_ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isAllowlisted(email: string | null | undefined): boolean {
  if (!email) return false;
  return platformAdminAllowlist().includes(email.toLowerCase());
}

/** Non-throwing check — useful for conditionally rendering admin UI/nav. */
export async function isPlatformAdmin(): Promise<boolean> {
  const session = await getServerSession();
  if (!session) return false;
  if (isAllowlisted(session.user.email)) return true;
  return isUserPlatformAdmin(session.user.id);
}

/**
 * Require the caller to be a platform administrator. Throws `AuthError` (401)
 * if unauthenticated or `ForbiddenError` (403) if authenticated but not a
 * platform admin. Call this first in every Admin Console route/service.
 */
export async function requirePlatformAdmin() {
  const session = await requireAuth();
  if (isAllowlisted(session.user.email)) return session;
  if (await isUserPlatformAdmin(session.user.id)) return session;
  throw new ForbiddenError('Platform administrator access required.');
}
