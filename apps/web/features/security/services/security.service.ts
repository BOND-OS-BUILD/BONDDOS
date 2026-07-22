import { requirePlatformAdmin, requireRole } from '@bond-os/auth';
import {
  createSecurityEvent,
  getSecurityEventStats,
  listSecurityEvents,
  type CreateSecurityEventInput,
  type SecurityEventPage,
  type SecurityEventStat,
} from '@bond-os/database';
import { ROLES, type SecurityEventQuery } from '@bond-os/shared';
import { logger } from '@bond-os/shared/server';

const log = logger.child('security');

/**
 * Phase 10 — Security monitoring. `recordSecurityEvent` is intentionally
 * failure-tolerant: a security-log write must never break the request that
 * triggered it (it is called from the API error boundary and rate limiter).
 */
export async function recordSecurityEvent(input: CreateSecurityEventInput): Promise<void> {
  try {
    await createSecurityEvent(input);
  } catch (error) {
    log.warn('Failed to record security event', {
      type: input.type,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface SecurityDashboardData {
  events: SecurityEventPage;
  stats: { byType: SecurityEventStat[]; total: number };
  sinceDays: number;
}

function sinceFrom(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Org-scoped Security Dashboard (org ADMIN or OWNER). */
export async function getOrgSecurityDashboard(
  organizationId: string,
  query: SecurityEventQuery,
): Promise<SecurityDashboardData> {
  await requireRole(organizationId, ROLES.ADMIN);
  const since = sinceFrom(query.sinceDays);
  const [events, stats] = await Promise.all([
    listSecurityEvents({ organizationId, type: query.type, since, page: query.page, pageSize: query.pageSize }),
    getSecurityEventStats({ organizationId, since }),
  ]);
  return { events, stats, sinceDays: query.sinceDays };
}

/** Deployment-wide security events (platform admin — Admin Console). */
export async function getPlatformSecurityEvents(query: SecurityEventQuery): Promise<SecurityDashboardData> {
  await requirePlatformAdmin();
  const since = sinceFrom(query.sinceDays);
  const [events, stats] = await Promise.all([
    listSecurityEvents({ type: query.type, since, page: query.page, pageSize: query.pageSize }),
    getSecurityEventStats({ since }),
  ]);
  return { events, stats, sinceDays: query.sinceDays };
}
