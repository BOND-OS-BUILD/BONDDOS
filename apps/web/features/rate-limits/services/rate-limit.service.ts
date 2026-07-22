import { requirePlatformAdmin } from '@bond-os/auth';
import {
  deleteRateLimitPolicy,
  getRateLimitPolicy,
  listRateLimitPolicies,
  upsertRateLimitPolicy,
  type RateLimitPolicyRecord,
} from '@bond-os/database';
import {
  RateLimitError,
  type DeleteRateLimitPolicyInput,
  type RateLimitScopeName,
  type UpsertRateLimitPolicyInput,
} from '@bond-os/shared';
import { getClientIp, getEnv, getRateLimiter } from '@bond-os/shared/server';

import { recordSecurityEvent } from '@/features/security/services/security.service';

/**
 * Phase 10 — configurable, scope-aware rate limiting layered on the existing
 * `getRateLimiter()` (which stays the pluggable backend — in-memory today,
 * Redis-swappable per its own docs). Effective limits resolve as:
 *   specific policy row (scope, identifier) → default policy row (scope, '')
 *   → per-scope code default → env RATE_LIMIT_DEFAULT_*.
 * A breach records a RATE_LIMIT_EXCEEDED security event and throws
 * `RateLimitError` (→ 429 via apiHandler).
 */

const SCOPE_DEFAULTS: Record<RateLimitScopeName, { limit: number; windowSeconds: number }> = {
  USER: { limit: 300, windowSeconds: 60 },
  ORGANIZATION: { limit: 1000, windowSeconds: 60 },
  API: { limit: 120, windowSeconds: 60 },
  AI: { limit: 30, windowSeconds: 60 },
  TOOL: { limit: 60, windowSeconds: 60 },
  WORKFLOW: { limit: 60, windowSeconds: 60 },
};

export interface ResolvedRateLimit {
  limit: number;
  windowSeconds: number;
  enabled: boolean;
}

export async function resolveRateLimitPolicy(
  scope: RateLimitScopeName,
  identifier: string,
): Promise<ResolvedRateLimit> {
  const specific = identifier ? await getRateLimitPolicy(scope, identifier) : null;
  const policy: RateLimitPolicyRecord | null = specific ?? (await getRateLimitPolicy(scope, ''));
  if (policy) {
    return { limit: policy.limit, windowSeconds: policy.windowSeconds, enabled: policy.enabled };
  }
  const env = getEnv();
  const fallback = SCOPE_DEFAULTS[scope] ?? {
    limit: env.RATE_LIMIT_DEFAULT_LIMIT,
    windowSeconds: env.RATE_LIMIT_DEFAULT_WINDOW_SECONDS,
  };
  return { ...fallback, enabled: true };
}

export interface EnforceRateLimitOptions {
  scope: RateLimitScopeName;
  /** The subject the limit is keyed on — e.g. organizationId, userId, or an IP. */
  identifier: string;
  request?: Request;
  userId?: string | null;
  organizationId?: string | null;
}

/** Consume one token for `(scope, identifier)`; throws `RateLimitError` if over. */
export async function enforceRateLimit(options: EnforceRateLimitOptions): Promise<void> {
  const policy = await resolveRateLimitPolicy(options.scope, options.identifier);
  if (!policy.enabled) return;

  const key = `${options.scope}:${options.identifier}`;
  const result = await getRateLimiter().consume(key, {
    limit: policy.limit,
    windowSeconds: policy.windowSeconds,
  });

  if (!result.success) {
    await recordSecurityEvent({
      type: 'RATE_LIMIT_EXCEEDED',
      userId: options.userId ?? null,
      organizationId: options.organizationId ?? null,
      ipAddress: options.request ? getClientIp(options.request) : null,
      route: options.request ? new URL(options.request.url).pathname : null,
      metadata: { scope: options.scope, limit: policy.limit, windowSeconds: policy.windowSeconds },
    });
    throw new RateLimitError();
  }
}

// ── Admin (platform-admin only) ──────────────────────────────────────────

export async function listRateLimitPoliciesService(): Promise<RateLimitPolicyRecord[]> {
  await requirePlatformAdmin();
  return listRateLimitPolicies();
}

export async function upsertRateLimitPolicyService(
  input: UpsertRateLimitPolicyInput,
): Promise<RateLimitPolicyRecord> {
  const session = await requirePlatformAdmin();
  return upsertRateLimitPolicy({ ...input, updatedById: session.user.id });
}

export async function deleteRateLimitPolicyService(input: DeleteRateLimitPolicyInput): Promise<void> {
  await requirePlatformAdmin();
  await deleteRateLimitPolicy(input.scope, input.key ?? '');
}
