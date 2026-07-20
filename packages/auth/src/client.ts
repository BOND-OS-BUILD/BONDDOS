import { createAuthClient } from 'better-auth/react';

/**
 * Client-side Better Auth client. Safe to import from Client Components —
 * unlike `./server`, this has no server-only dependencies. `baseURL` reads
 * `NEXT_PUBLIC_APP_URL`, which Next.js inlines into the client bundle.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
});

export const { signIn, signUp, signOut, useSession, requestPasswordReset, resetPassword } = authClient;
