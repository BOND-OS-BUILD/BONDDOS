import 'server-only';

import { prisma } from '@bond-os/database';
import { getEnv, logger } from '@bond-os/shared/server';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

import { getEmailProvider, renderResetPasswordEmail } from './email';

const log = logger.child('auth');

const ONE_WEEK_SECONDS = 60 * 60 * 24 * 7;
const ONE_DAY_SECONDS = 60 * 60 * 24;

function createAuth() {
  const env = getEnv();
  return betterAuth({
    database: prismaAdapter(prisma, {
      provider: 'postgresql',
    }),
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60, // 1 hour
      sendResetPassword: async ({ user, url }) => {
        const { html, text } = renderResetPasswordEmail(url);
        await getEmailProvider().send({
          to: user.email,
          subject: 'Reset your BOND OS password',
          html,
          text,
        });
        log.info('Password reset email queued', { userId: user.id });
      },
    },
    session: {
      expiresIn: ONE_WEEK_SECONDS,
      updateAge: ONE_DAY_SECONDS,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
    advanced: {
      useSecureCookies: env.NODE_ENV === 'production',
      cookiePrefix: 'bondos',
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let authInstance: Auth | undefined;

/**
 * The single Better Auth server instance for BOND OS, lazily constructed on
 * first access — mirrors the lazy-singleton composition-root pattern used
 * everywhere else in this codebase (e.g. `getAgentRegistry()`). Constructing
 * `betterAuth(...)` reads `getEnv()`, and doing that eagerly at module scope
 * means simply *importing* this file (which `./session.ts`'s `requireAuth`/
 * `requireRole` — used by nearly every route — transitively does) requires
 * `DATABASE_URL`/`BETTER_AUTH_SECRET` to already be valid, including during
 * Next's build-time "Collecting page data" step, which evaluates every route
 * module. Laziness defers that requirement to actual request time, where it
 * belongs. Mounted by `apps/web/app/api/auth/[...all]/route.ts`; consumed
 * server-side via `getServerSession`/`requireAuth` in `./session.ts`, and
 * client-side via `createAuthClient` in `./client.ts`.
 */
export function getAuth(): Auth {
  if (!authInstance) {
    authInstance = createAuth();
  }
  return authInstance;
}
