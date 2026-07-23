/**
 * Phase 11 — public API scope catalog (client-safe). Scopes gate what an API
 * key (or plugin) may do. `*` is the super-scope (all). Every /api/v1 route
 * declares the scope it requires; the auth layer checks it against the key's
 * granted scopes AND the caller's organization membership — a scope never
 * grants cross-organization access.
 */
export interface ApiScopeDefinition {
  scope: string;
  description: string;
}

export const API_SCOPES: readonly ApiScopeDefinition[] = [
  { scope: 'projects:read', description: 'Read projects' },
  { scope: 'projects:write', description: 'Create and update projects' },
  { scope: 'tasks:read', description: 'Read tasks' },
  { scope: 'tasks:write', description: 'Create and update tasks' },
  { scope: 'documents:read', description: 'Read documents' },
  { scope: 'customers:read', description: 'Read customers' },
  { scope: 'meetings:read', description: 'Read meetings' },
  { scope: 'search:read', description: 'Search and retrieval' },
  { scope: 'graph:read', description: 'Read the knowledge graph' },
  { scope: 'workflows:read', description: 'Read workflows and runs' },
  { scope: 'notifications:read', description: 'Read notifications' },
  { scope: 'custom-objects:read', description: 'Read custom objects' },
  { scope: 'custom-objects:write', description: 'Create and update custom objects' },
  { scope: 'webhooks:manage', description: 'Manage webhook subscriptions' },
];

export const ALL_API_SCOPES: string[] = API_SCOPES.map((definition) => definition.scope);

export const SUPER_SCOPE = '*';

/** Whether the granted scope set satisfies a required scope. `*` satisfies all. */
export function scopeSatisfies(granted: readonly string[], required: string): boolean {
  return granted.includes(SUPER_SCOPE) || granted.includes(required);
}

/** Validate a requested scope list against the catalog (`*` is always allowed). */
export function areScopesValid(scopes: readonly string[]): boolean {
  return scopes.every((scope) => scope === SUPER_SCOPE || ALL_API_SCOPES.includes(scope));
}
