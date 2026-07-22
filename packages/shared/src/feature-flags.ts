/**
 * Phase 10 — feature flag registry (client-safe; no server-only imports).
 *
 * Flags evaluate at three scopes with precedence USER > ORGANIZATION > GLOBAL.
 * An unset flag falls back to its registered `defaultEnabled`. Known flags are
 * declared here so the app and the Admin Console share one source of truth,
 * but the `FeatureFlag` table also accepts arbitrary keys (ad-hoc
 * kill-switches created at runtime from the Admin Console).
 */
export const FEATURE_FLAGS = {
  ADMIN_CONSOLE: 'admin.console',
  ORG_ANALYTICS: 'analytics.organization',
  USAGE_METERING: 'metering.usage',
  BACKGROUND_OPS: 'ops.background_dashboard',
  SECURITY_DASHBOARD: 'security.dashboard',
  AI_STREAMING: 'ai.streaming',
} as const;

export type FeatureFlagKey = (typeof FEATURE_FLAGS)[keyof typeof FEATURE_FLAGS];

export type FeatureFlagScopeName = 'GLOBAL' | 'ORGANIZATION' | 'USER';

export interface FeatureFlagDefinition {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

export const FEATURE_FLAG_DEFINITIONS: readonly FeatureFlagDefinition[] = [
  { key: FEATURE_FLAGS.ADMIN_CONSOLE, label: 'Admin Console', description: 'Platform administration portal.', defaultEnabled: true },
  { key: FEATURE_FLAGS.ORG_ANALYTICS, label: 'Organization Analytics', description: 'Per-organization analytics dashboards.', defaultEnabled: true },
  { key: FEATURE_FLAGS.USAGE_METERING, label: 'Usage Metering', description: 'Track usage for future billing.', defaultEnabled: true },
  { key: FEATURE_FLAGS.BACKGROUND_OPS, label: 'Background Ops Dashboard', description: 'Queue and background-job monitoring.', defaultEnabled: true },
  { key: FEATURE_FLAGS.SECURITY_DASHBOARD, label: 'Security Dashboard', description: 'Security events and access monitoring.', defaultEnabled: true },
  { key: FEATURE_FLAGS.AI_STREAMING, label: 'AI Streaming', description: 'Stream Mr. Bond responses token-by-token.', defaultEnabled: false },
];

/** The registered default for a flag, or `false` for an unknown ad-hoc key. */
export function featureFlagDefault(key: string): boolean {
  return FEATURE_FLAG_DEFINITIONS.find((definition) => definition.key === key)?.defaultEnabled ?? false;
}
