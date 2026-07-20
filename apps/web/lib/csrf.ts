import { ForbiddenError } from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';

/**
 * Lightweight CSRF defense for our own mutating API routes (Better Auth's
 * `/api/auth/*` endpoints protect themselves via `trustedOrigins`). Verifies
 * the request's `Origin` header — set by browsers on every cross-origin and
 * same-origin fetch/form POST — matches our own app URL. This is the same
 * mitigation Next.js Server Actions use internally, and is simpler and less
 * error-prone than hand-rolled double-submit tokens while covering the same
 * threat model for a same-origin SPA with no public write API.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin) {
    // Same-origin requests issued by fetch() always send Origin for
    // state-changing methods; a missing header on a mutating request is
    // suspicious enough to reject outright.
    throw new ForbiddenError('Missing Origin header.');
  }

  const allowed = new URL(getEnv().APP_URL).origin;
  if (origin !== allowed) {
    throw new ForbiddenError('Cross-origin request rejected.');
  }
}
