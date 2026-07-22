import { requirePlatformAdmin } from '@bond-os/auth';
import {
  getPlatformAiUsage,
  getPlatformStats,
  getPlatformUserStats,
  listFeatureFlags,
  listPlatformAuditEvents,
  listPlatformOrganizations,
  listPlatformSessions,
  listPlatformToolExecutions,
  listPlatformUsers,
  listPlatformWorkflowRuns,
  listRateLimitPolicies,
  setUserPlatformAdmin,
} from '@bond-os/database';
import { ForbiddenError, type AnalyticsWindowQuery } from '@bond-os/shared';

import { getHealthReport } from '@/features/health/services/health.service';

/**
 * Phase 10 — Admin Console composition. Every export gates on
 * `requirePlatformAdmin()` first; the underlying platform repositories are
 * cross-organization by design and must never be reachable without it.
 */

interface PageParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

function windowSince(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export async function getAdminOverview() {
  await requirePlatformAdmin();
  const [stats, health, aiUsage] = await Promise.all([
    getPlatformStats(),
    getHealthReport(),
    getPlatformAiUsage(windowSince(30)),
  ]);
  return { stats, health, aiUsage };
}

export async function listAdminOrganizations(params: PageParams) {
  await requirePlatformAdmin();
  return listPlatformOrganizations(params);
}

export async function listAdminUsers(params: PageParams) {
  await requirePlatformAdmin();
  const [users, stats] = await Promise.all([listPlatformUsers(params), getPlatformUserStats()]);
  return { users, stats };
}

export async function setAdminUserPlatformAdmin(userId: string, isPlatformAdmin: boolean): Promise<void> {
  const session = await requirePlatformAdmin();
  if (!isPlatformAdmin && session.user.id === userId) {
    throw new ForbiddenError('You cannot revoke your own platform-admin access.');
  }
  await setUserPlatformAdmin(userId, isPlatformAdmin);
}

export async function listAdminSessions(params: PageParams) {
  await requirePlatformAdmin();
  return listPlatformSessions(params);
}

export async function listAdminWorkflowRuns(params: PageParams) {
  await requirePlatformAdmin();
  return listPlatformWorkflowRuns(params);
}

export async function listAdminToolExecutions(params: PageParams) {
  await requirePlatformAdmin();
  return listPlatformToolExecutions(params);
}

export async function listAdminAuditEvents(params: PageParams) {
  await requirePlatformAdmin();
  return listPlatformAuditEvents(params);
}

export async function getAdminAiUsage(query: AnalyticsWindowQuery) {
  await requirePlatformAdmin();
  return getPlatformAiUsage(windowSince(query.sinceDays));
}

/**
 * Configuration export (feature flags + rate-limit policies) as a portable
 * JSON snapshot — the "Configuration Export" of the backup story. Database
 * and object-storage exports are operator procedures (pg_dump / storage
 * copy) documented in docs/backups.md, not app endpoints.
 */
export async function getConfigurationExport() {
  await requirePlatformAdmin();
  const [featureFlags, rateLimitPolicies] = await Promise.all([listFeatureFlags(), listRateLimitPolicies()]);
  return {
    kind: 'bond-os-configuration-export',
    version: '1.1.0',
    featureFlags,
    rateLimitPolicies,
  };
}
