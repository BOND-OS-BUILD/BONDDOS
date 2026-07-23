import { z } from 'zod';

import { ALL_API_SCOPES, SUPER_SCOPE } from './api-scopes';
import { areEventPatternsValid } from './events';

/**
 * Phase 11 — the plugin manifest contract + its security rules (client-safe).
 *
 * Plugins are DECLARATIVE, not executable: a manifest declares the scopes it
 * needs, the routes it serves (always under its own `/plugins/<id>/`
 * namespace), the UI slots it contributes, and the events it hooks. The
 * platform validates and records these declarations; it never evals plugin
 * code. This is what makes the four security invariants enforceable:
 *   1. cannot bypass permissions — a plugin only ever gets the scopes its
 *      installation granted, and those must be real, non-super API scopes;
 *   2. cannot access other orgs — installations and every plugin-issued API
 *      call are org-scoped by the same layer as first-party calls;
 *   3. cannot modify core — routes must live under `/plugins/<id>/`, so a
 *      manifest can never claim a core route;
 *   4. cannot inject code — there is no code field and nothing is executed;
 *      behaviour is delivered out-of-process via webhooks / hosted URLs.
 */

export const PLUGIN_COMPONENT_SLOTS = [
  'dashboard.widget',
  'project.panel',
  'record.action',
  'settings.section',
  'nav.item',
] as const;
export type PluginComponentSlot = (typeof PLUGIN_COMPONENT_SLOTS)[number];

export const PLUGIN_ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

const PLUGIN_ID_RE = /^[a-z][a-z0-9-]{1,48}[a-z0-9]$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;

export const pluginRouteSchema = z.object({
  path: z.string().trim().min(1).max(200),
  method: z.enum(PLUGIN_ROUTE_METHODS).default('GET'),
});

export const pluginComponentSchema = z.object({
  slot: z.enum(PLUGIN_COMPONENT_SLOTS),
  name: z.string().trim().min(1).max(120),
  /** A hosted URL rendered in the slot (iframe/link). No inline code. */
  url: z.string().url().max(2048).optional(),
});

export const pluginHookSchema = z.object({
  event: z.string().trim().min(1).max(120),
  /** Webhook receiver invoked when the event fires. */
  url: z.string().url().max(2048).optional(),
});

export const pluginManifestSchema = z
  .object({
    id: z.string().trim().regex(PLUGIN_ID_RE, 'Plugin id must be kebab-case (3–50 chars).'),
    name: z.string().trim().min(1).max(120),
    version: z.string().trim().regex(VERSION_RE, 'Version must be semver, e.g. 1.0.0.'),
    author: z.string().trim().max(120).optional(),
    description: z.string().trim().max(600).optional(),
    permissions: z.array(z.string().trim().min(1)).max(40).default([]),
    routes: z.array(pluginRouteSchema).max(40).default([]),
    components: z.array(pluginComponentSchema).max(40).default([]),
    services: z.array(z.string().trim().min(1).max(120)).max(40).default([]),
    hooks: z.array(pluginHookSchema).max(40).default([]),
  })
  .superRefine((manifest, ctx) => {
    // 1 — permissions must be real, non-super scopes.
    for (const permission of manifest.permissions) {
      if (permission === SUPER_SCOPE || !ALL_API_SCOPES.includes(permission)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['permissions'],
          message: `"${permission}" is not a grantable scope.`,
        });
      }
    }
    // 3 — routes must stay inside the plugin's own namespace.
    const prefix = `/plugins/${manifest.id}/`;
    for (const route of manifest.routes) {
      if (!route.path.startsWith(prefix)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['routes'],
          message: `Route "${route.path}" must start with ${prefix}.`,
        });
      }
    }
    // hooks must reference known event patterns.
    const hookEvents = manifest.hooks.map((hook) => hook.event);
    if (hookEvents.length > 0 && !areEventPatternsValid(hookEvents)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hooks'], message: 'One or more hook events are unknown.' });
    }
  });

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

/**
 * Pure defensive re-check of the invariants (used server-side in addition to
 * the schema). Returns a list of human-readable violations — empty when safe.
 */
export function validatePluginManifestSafety(manifest: PluginManifest): string[] {
  const violations: string[] = [];
  for (const permission of manifest.permissions) {
    if (permission === SUPER_SCOPE || !ALL_API_SCOPES.includes(permission)) {
      violations.push(`Permission "${permission}" is not a grantable scope.`);
    }
  }
  const prefix = `/plugins/${manifest.id}/`;
  for (const route of manifest.routes) {
    if (!route.path.startsWith(prefix)) violations.push(`Route "${route.path}" escapes the plugin namespace ${prefix}.`);
  }
  if (manifest.hooks.length > 0 && !areEventPatternsValid(manifest.hooks.map((hook) => hook.event))) {
    violations.push('One or more hook events are unknown.');
  }
  return violations;
}
