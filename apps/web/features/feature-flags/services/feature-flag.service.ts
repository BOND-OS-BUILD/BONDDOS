import { requirePlatformAdmin } from '@bond-os/auth';
import {
  deleteFeatureFlag,
  getEffectiveFlagRows,
  listFeatureFlags,
  upsertFeatureFlag,
  type FeatureFlagRecord,
} from '@bond-os/database';
import {
  featureFlagDefault,
  FEATURE_FLAG_DEFINITIONS,
  type DeleteFeatureFlagInput,
  type SetFeatureFlagInput,
} from '@bond-os/shared';

/**
 * Phase 10 — feature-flag evaluation + management.
 *
 * Evaluation reads directly from the database (a cheap indexed lookup) so a
 * change from the Admin Console takes effect on the very next request — the
 * "runtime enable/disable" the spec calls for. Precedence is
 * USER > ORGANIZATION > GLOBAL, then the registered default.
 */

export interface FlagEvaluationContext {
  organizationId?: string | null;
  userId?: string | null;
}

function evaluate(
  key: string,
  rows: FeatureFlagRecord[],
  organizationId: string | null,
  userId: string | null,
): boolean {
  if (userId) {
    const userRow = rows.find((r) => r.key === key && r.scope === 'USER' && r.scopeId === userId);
    if (userRow) return userRow.enabled;
  }
  if (organizationId) {
    const orgRow = rows.find((r) => r.key === key && r.scope === 'ORGANIZATION' && r.scopeId === organizationId);
    if (orgRow) return orgRow.enabled;
  }
  const globalRow = rows.find((r) => r.key === key && r.scope === 'GLOBAL');
  if (globalRow) return globalRow.enabled;
  return featureFlagDefault(key);
}

/** Whether a single flag is enabled for the given context. */
export async function isFeatureEnabled(key: string, ctx: FlagEvaluationContext): Promise<boolean> {
  const organizationId = ctx.organizationId ?? null;
  const userId = ctx.userId ?? null;
  const rows = await getEffectiveFlagRows(organizationId, userId);
  return evaluate(key, rows, organizationId, userId);
}

/** Evaluate every known + ad-hoc flag for the context into a `{ key: bool }` map. */
export async function evaluateAllFlags(ctx: FlagEvaluationContext): Promise<Record<string, boolean>> {
  const organizationId = ctx.organizationId ?? null;
  const userId = ctx.userId ?? null;
  const rows = await getEffectiveFlagRows(organizationId, userId);
  const keys = new Set<string>([
    ...FEATURE_FLAG_DEFINITIONS.map((definition) => definition.key),
    ...rows.map((row) => row.key),
  ]);
  const result: Record<string, boolean> = {};
  for (const key of keys) {
    result[key] = evaluate(key, rows, organizationId, userId);
  }
  return result;
}

// ── Admin (platform-admin only) ──────────────────────────────────────────

export interface FeatureFlagAdminView {
  definitions: typeof FEATURE_FLAG_DEFINITIONS;
  flags: FeatureFlagRecord[];
}

export async function listFeatureFlagsService(): Promise<FeatureFlagAdminView> {
  await requirePlatformAdmin();
  const flags = await listFeatureFlags();
  return { definitions: FEATURE_FLAG_DEFINITIONS, flags };
}

export async function setFeatureFlagService(input: SetFeatureFlagInput): Promise<FeatureFlagRecord> {
  const session = await requirePlatformAdmin();
  return upsertFeatureFlag({
    key: input.key,
    scope: input.scope,
    scopeId: input.scopeId ?? null,
    enabled: input.enabled,
    description: input.description ?? null,
    updatedById: session.user.id,
  });
}

export async function deleteFeatureFlagService(input: DeleteFeatureFlagInput): Promise<void> {
  await requirePlatformAdmin();
  await deleteFeatureFlag(input.key, input.scope, input.scopeId ?? null);
}
