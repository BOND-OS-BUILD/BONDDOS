import { createHash } from 'node:crypto';

import { requirePlatformAdmin } from '@bond-os/auth';
import {
  getErrorGroupWithEvents,
  getErrorStats,
  listErrorGroups,
  recordError,
  setErrorGroupResolved,
} from '@bond-os/database';
import { NotFoundError, type ErrorGroupQuery, type ResolveErrorGroupInput } from '@bond-os/shared';
import { logger } from '@bond-os/shared/server';

const log = logger.child('error-reporting');

/** Collapse volatile bits (ids, numbers, hex) so like errors group together. */
function normalizeMessage(message: string): string {
  return message
    .replace(/0x[0-9a-f]+/gi, 'HEX')
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, 'UUID')
    .replace(/\d+/g, 'N')
    .slice(0, 200);
}

function fingerprintOf(parts: Array<string | number | null | undefined>): string {
  return createHash('sha1').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex').slice(0, 32);
}

export interface CaptureErrorInput {
  message: string;
  stack?: string | null;
  route?: string | null;
  method?: string | null;
  statusCode?: number | null;
  userId?: string | null;
  organizationId?: string | null;
  url?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  source?: 'server' | 'client';
}

/** Capture one error occurrence. Never throws — reporting must not cascade. */
export async function captureError(input: CaptureErrorInput): Promise<void> {
  try {
    const routeKey = input.route ?? input.url ?? 'unknown';
    const fingerprint = fingerprintOf([
      input.source ?? 'server',
      routeKey,
      input.statusCode ?? 500,
      normalizeMessage(input.message),
    ]);
    await recordError({
      fingerprint,
      title: `${input.statusCode ?? ''} ${routeKey}`.trim() || 'error',
      message: input.message,
      level: (input.statusCode ?? 500) >= 500 ? 'error' : 'warn',
      route: input.route ?? null,
      method: input.method ?? null,
      statusCode: input.statusCode ?? null,
      requestId: input.requestId ?? null,
      correlationId: input.correlationId ?? null,
      userId: input.userId ?? null,
      organizationId: input.organizationId ?? null,
      url: input.url ?? null,
      userAgent: input.userAgent ?? null,
      stack: input.stack ?? null,
    });
  } catch (error) {
    log.warn('Failed to capture error report', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Admin (platform-admin only) ──────────────────────────────────────────

export async function listErrorGroupsService(query: ErrorGroupQuery) {
  await requirePlatformAdmin();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [groups, stats] = await Promise.all([
    listErrorGroups({ resolved: query.resolved, page: query.page, pageSize: query.pageSize }),
    getErrorStats(since),
  ]);
  return { groups, stats };
}

export async function getErrorGroupService(id: string) {
  await requirePlatformAdmin();
  const result = await getErrorGroupWithEvents(id);
  if (!result) throw new NotFoundError('Error group not found.');
  return result;
}

export async function resolveErrorGroupService(input: ResolveErrorGroupInput): Promise<void> {
  await requirePlatformAdmin();
  await setErrorGroupResolved(input.id, input.resolved);
}
