import 'server-only';

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Phase 10 — per-request context propagated via AsyncLocalStorage. There was
 * no request-scoped context in the codebase before this; the logger
 * (`packages/shared/src/logger.ts`) reads from here to automatically stamp
 * every log line with requestId / correlationId / userId / organizationId
 * without threading them through call sites. Populated by `apiHandler`
 * (requestId, correlationId, route, method) and enriched by `requireAuth` /
 * `requireActiveOrganizationId` (userId, organizationId). Node/Next server
 * runtime only — the Edge middleware never imports this.
 */
export interface RequestContext {
  requestId: string;
  correlationId: string;
  userId?: string;
  organizationId?: string;
  route?: string;
  method?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with `context` as the active request context. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The active request context, or `undefined` outside a request. */
export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/** Merge fields into the active request context (no-op outside a request). */
export function updateRequestContext(patch: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

/** Fresh RFC4122 request id. */
export function newRequestId(): string {
  return randomUUID();
}
