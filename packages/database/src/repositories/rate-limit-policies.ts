import type { RateLimitScope } from '../generated';
import { prisma } from '../client';

/**
 * Phase 10 — configurable rate-limit policies. The default policy for a scope
 * uses an empty-string `key` (never null), so the `(scope, key)` unique key
 * and upsert behave uniformly (same rationale as feature flags). A non-empty
 * key targets a specific org / user / route.
 */

export interface RateLimitPolicyRecord {
  id: string;
  scope: RateLimitScope;
  key: string | null;
  limit: number;
  windowSeconds: number;
  enabled: boolean;
  description: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listRateLimitPolicies(): Promise<RateLimitPolicyRecord[]> {
  return prisma.rateLimitPolicy.findMany({ orderBy: [{ scope: 'asc' }, { key: 'asc' }] });
}

export async function getRateLimitPolicy(scope: RateLimitScope, key?: string | null): Promise<RateLimitPolicyRecord | null> {
  return prisma.rateLimitPolicy.findUnique({ where: { scope_key: { scope, key: key ?? '' } } });
}

export interface UpsertRateLimitPolicyData {
  scope: RateLimitScope;
  key?: string | null;
  limit: number;
  windowSeconds: number;
  enabled?: boolean;
  description?: string | null;
  updatedById?: string | null;
}

export async function upsertRateLimitPolicy(input: UpsertRateLimitPolicyData): Promise<RateLimitPolicyRecord> {
  const key = input.key ?? '';
  return prisma.rateLimitPolicy.upsert({
    where: { scope_key: { scope: input.scope, key } },
    create: {
      scope: input.scope,
      key,
      limit: input.limit,
      windowSeconds: input.windowSeconds,
      enabled: input.enabled ?? true,
      description: input.description ?? null,
      updatedById: input.updatedById ?? null,
    },
    update: {
      limit: input.limit,
      windowSeconds: input.windowSeconds,
      enabled: input.enabled ?? true,
      description: input.description ?? undefined,
      updatedById: input.updatedById ?? null,
    },
  });
}

export async function deleteRateLimitPolicy(scope: RateLimitScope, key?: string | null): Promise<boolean> {
  const result = await prisma.rateLimitPolicy.deleteMany({ where: { scope, key: key ?? '' } });
  return result.count > 0;
}
