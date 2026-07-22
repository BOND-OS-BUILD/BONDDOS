import type { FeatureFlagScope } from '../generated';
import { prisma } from '../client';

/**
 * Phase 10 — feature-flag persistence. GLOBAL rows use an empty-string
 * `scopeId` (never null) so the `(key, scope, scopeId)` unique key — and
 * therefore upsert — behaves the same for all three scopes without tripping
 * Prisma's null-in-compound-unique limitation. Evaluation precedence
 * (USER > ORGANIZATION > GLOBAL) lives in the service layer.
 */

export interface FeatureFlagRecord {
  id: string;
  key: string;
  scope: FeatureFlagScope;
  scopeId: string | null;
  enabled: boolean;
  description: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export function normalizeScopeId(scope: FeatureFlagScope, scopeId?: string | null): string {
  return scope === 'GLOBAL' ? '' : (scopeId ?? '');
}

export interface UpsertFeatureFlagInput {
  key: string;
  scope: FeatureFlagScope;
  scopeId?: string | null;
  enabled: boolean;
  description?: string | null;
  updatedById?: string | null;
}

export async function upsertFeatureFlag(input: UpsertFeatureFlagInput): Promise<FeatureFlagRecord> {
  const scopeId = normalizeScopeId(input.scope, input.scopeId);
  return prisma.featureFlag.upsert({
    where: { key_scope_scopeId: { key: input.key, scope: input.scope, scopeId } },
    create: {
      key: input.key,
      scope: input.scope,
      scopeId,
      enabled: input.enabled,
      description: input.description ?? null,
      updatedById: input.updatedById ?? null,
    },
    update: {
      enabled: input.enabled,
      description: input.description ?? undefined,
      updatedById: input.updatedById ?? null,
    },
  });
}

export async function deleteFeatureFlag(
  key: string,
  scope: FeatureFlagScope,
  scopeId?: string | null,
): Promise<boolean> {
  const result = await prisma.featureFlag.deleteMany({
    where: { key, scope, scopeId: normalizeScopeId(scope, scopeId) },
  });
  return result.count > 0;
}

export async function listFeatureFlags(): Promise<FeatureFlagRecord[]> {
  return prisma.featureFlag.findMany({ orderBy: [{ key: 'asc' }, { scope: 'asc' }] });
}

/** Only the rows relevant to evaluating flags for one org/user context. */
export async function getEffectiveFlagRows(
  organizationId: string | null,
  userId: string | null,
): Promise<FeatureFlagRecord[]> {
  return prisma.featureFlag.findMany({
    where: {
      OR: [
        { scope: 'GLOBAL' },
        ...(organizationId ? [{ scope: 'ORGANIZATION' as const, scopeId: organizationId }] : []),
        ...(userId ? [{ scope: 'USER' as const, scopeId: userId }] : []),
      ],
    },
  });
}
