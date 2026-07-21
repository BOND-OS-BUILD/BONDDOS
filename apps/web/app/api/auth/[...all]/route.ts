import { getAuth } from '@bond-os/auth';
import { toNextJsHandler } from 'better-auth/next-js';

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
  return toNextJsHandler(getAuth()).POST(request);
}
