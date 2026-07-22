import { getAuth } from '@bond-os/auth';
import { getClientIp } from '@bond-os/shared/server';
import { toNextJsHandler } from 'better-auth/next-js';

import { recordSecurityEvent } from '@/features/security/services/security.service';

/**
 * `toNextJsHandler(getAuth())` is deliberately called per-request, not at
 * module scope — `getAuth()` reads `getEnv()` on first call, and evaluating
 * that at import time would make this route's own build-time page-data
 * collection require `DATABASE_URL`/`BETTER_AUTH_SECRET` to exist. See
 * `getAuth`'s own doc comment in `packages/auth/src/server.ts`.
 */
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  const response = await toNextJsHandler(getAuth()).POST(request);
  await recordLoginAttempt(request, response);
  return response;
}

/**
 * Phase 10 — record sign-in attempts for the Security Dashboard. Only the
 * sign-in endpoints are recorded (not sign-up / get-session / sign-out), and a
 * failed analytics write never affects the auth response.
 */
async function recordLoginAttempt(request: Request, response: Response): Promise<void> {
  const path = new URL(request.url).pathname;
  if (!path.includes('/sign-in')) return;
  const succeeded = response.status >= 200 && response.status < 300;
  await recordSecurityEvent({
    type: succeeded ? 'LOGIN_SUCCEEDED' : 'LOGIN_FAILED',
    ipAddress: getClientIp(request),
    userAgent: request.headers.get('user-agent'),
    route: path,
  });
}
