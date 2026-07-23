import { findApiKeyByHash, touchApiKey } from '@bond-os/database';
import { AuthError, ForbiddenError, scopeSatisfies } from '@bond-os/shared';
import { updateRequestContext } from '@bond-os/shared/server';

import { apiHandler } from '@/lib/api-handler';
import { enforceRateLimit } from '@/features/rate-limits/services/rate-limit.service';

import { extractBearerToken, hashApiKey, looksLikeApiKey } from '../lib/key';

/**
 * Phase 11 — public API (`/api/v1`) authentication. Requests authenticate with
 * an API key bearer token instead of a session cookie. The resolved context is
 * strictly org-scoped: every downstream query must be filtered by
 * `organizationId`, so a key can never read another organization's data. A
 * PERSONAL key additionally carries `userId`; an ORGANIZATION key has none.
 */

export interface ApiKeyContext {
  keyId: string;
  organizationId: string;
  userId: string | null;
  scopes: string[];
}

/**
 * Authenticate a public-API request by its bearer token. Throws `AuthError`
 * (401) when the key is missing, malformed, unknown, revoked, or expired.
 * Stamps the request-context org/user for correlated logging and records a
 * best-effort `lastUsedAt` without blocking the request.
 */
export async function resolveApiKeyContext(request: Request): Promise<ApiKeyContext> {
  const token = extractBearerToken(request.headers.get('authorization'));
  if (!token || !looksLikeApiKey(token)) {
    throw new AuthError('Provide a valid API key as a Bearer token.');
  }

  const record = await findApiKeyByHash(hashApiKey(token));
  if (!record) throw new AuthError('Invalid API key.');
  if (record.revokedAt) throw new AuthError('This API key has been revoked.');
  if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) {
    throw new AuthError('This API key has expired.');
  }

  updateRequestContext({
    organizationId: record.organizationId,
    userId: record.userId ?? undefined,
  });
  void touchApiKey(record.id).catch(() => {});

  return {
    keyId: record.id,
    organizationId: record.organizationId,
    userId: record.userId,
    scopes: record.scopes,
  };
}

/** Assert the key carries `scope` (or the `*` super-scope); else 403. */
export function requireScope(context: ApiKeyContext, scope: string): void {
  if (!scopeSatisfies(context.scopes, scope)) {
    throw new ForbiddenError(`This API key is missing the required scope: ${scope}.`);
  }
}

/**
 * Wrap a `/api/v1` route handler with the full public-API guard chain:
 * error enveloping + request context (via `apiHandler`), key authentication,
 * per-key rate limiting (Phase 10 `API` scope), and scope enforcement. The
 * handler receives the authenticated, org-scoped `ApiKeyContext`.
 */
export function apiV1Handler<Ctx = { params: Promise<Record<string, string>> }>(
  requiredScope: string | null,
  handler: (request: Request, apiContext: ApiKeyContext, routeContext: Ctx) => Promise<Response>,
) {
  return apiHandler<Ctx>(async (request, routeContext) => {
    const apiContext = await resolveApiKeyContext(request);
    await enforceRateLimit({
      scope: 'API',
      identifier: apiContext.keyId,
      request,
      userId: apiContext.userId,
      organizationId: apiContext.organizationId,
    });
    // `null` = any authenticated key (e.g. the discovery endpoint); a string
    // requires that specific scope.
    if (requiredScope !== null) requireScope(apiContext, requiredScope);
    return handler(request, apiContext, routeContext);
  });
}
