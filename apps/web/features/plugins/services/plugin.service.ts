import { requireRole } from '@bond-os/auth';
import {
  deleteInstallation,
  getInstallation,
  getPluginByKey,
  getPluginsByIds,
  listEnabledInstallations,
  listInstallations,
  setInstallationStatus,
  upsertInstallation,
  upsertPlugin,
  type PluginInstallationRecord,
  type PluginRecord,
  type Prisma,
} from '@bond-os/database';
import {
  ConflictError,
  NotFoundError,
  ROLES,
  ValidationError,
  pluginManifestSchema,
  validatePluginManifestSafety,
  type PluginComponentSlot,
  type PluginManifest,
} from '@bond-os/shared';

import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * Phase 11 — plugin lifecycle + isolation. Plugins are validated declarative
 * manifests (see @bond-os/shared/plugins). Installing an org-namespaces the
 * plugin's key so it can never collide with or read another org's plugins;
 * the installation records only the scopes the manifest declared (all of which
 * must be real, non-super API scopes). Enabling/disabling/uninstalling and
 * upgrading are ADMIN operations. Nothing here executes plugin code.
 */

function keyFor(organizationId: string, manifestId: string): string {
  return `${organizationId}.${manifestId}`;
}

function manifestOf(plugin: PluginRecord): PluginManifest {
  return plugin.manifest as unknown as PluginManifest;
}

export interface PluginView {
  id: string;
  name: string;
  version: string;
  author: string | null;
  description: string | null;
  status: PluginInstallationRecord['status'];
  grantedScopes: string[];
  permissions: string[];
  components: { slot: PluginComponentSlot; name: string; url?: string }[];
  hooks: { event: string; url?: string }[];
  routes: { path: string; method: string }[];
  installedAt: string;
}

function toView(plugin: PluginRecord, installation: PluginInstallationRecord): PluginView {
  const manifest = manifestOf(plugin);
  return {
    id: manifest.id,
    name: plugin.name,
    version: plugin.version,
    author: plugin.author,
    description: plugin.description,
    status: installation.status,
    grantedScopes: installation.grantedScopes,
    permissions: manifest.permissions,
    components: manifest.components,
    hooks: manifest.hooks,
    routes: manifest.routes,
    installedAt: installation.installedAt.toISOString(),
  };
}

async function requireAdminOrg(): Promise<{ organizationId: string; userId: string }> {
  const organizationId = await requireActiveOrganizationId();
  const { session } = await requireRole(organizationId, ROLES.ADMIN);
  return { organizationId, userId: session.user.id };
}

async function requireMemberOrg(): Promise<string> {
  const organizationId = await requireActiveOrganizationId();
  await requireRole(organizationId, ROLES.MEMBER);
  return organizationId;
}

/** Validate a manifest through the schema AND the defensive safety re-check. */
function validateManifest(input: unknown): PluginManifest {
  const parsed = pluginManifestSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError('The plugin manifest is invalid.', parsed.error.flatten());
  }
  const violations = validatePluginManifestSafety(parsed.data);
  if (violations.length > 0) {
    throw new ValidationError('The plugin manifest violates the security policy.', { violations });
  }
  return parsed.data;
}

export async function listPluginsService(): Promise<PluginView[]> {
  const organizationId = await requireMemberOrg();
  const installations = await listInstallations(organizationId);
  const plugins = await getPluginsByIds(installations.map((installation) => installation.pluginId));
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  return installations
    .map((installation) => {
      const plugin = byId.get(installation.pluginId);
      return plugin ? toView(plugin, installation) : null;
    })
    .filter((view): view is PluginView => view !== null);
}

async function resolveInstalled(
  organizationId: string,
  manifestId: string,
): Promise<{ plugin: PluginRecord; installation: PluginInstallationRecord }> {
  const plugin = await getPluginByKey(keyFor(organizationId, manifestId));
  if (!plugin) throw new NotFoundError('Plugin not found.');
  const installation = await getInstallation(organizationId, plugin.id);
  if (!installation) throw new NotFoundError('Plugin is not installed.');
  return { plugin, installation };
}

export async function getPluginService(manifestId: string): Promise<PluginView> {
  const organizationId = await requireMemberOrg();
  const { plugin, installation } = await resolveInstalled(organizationId, manifestId);
  return toView(plugin, installation);
}

export async function installPluginService(manifestInput: unknown): Promise<PluginView> {
  const { organizationId, userId } = await requireAdminOrg();
  const manifest = validateManifest(manifestInput);

  const key = keyFor(organizationId, manifest.id);
  const existing = await getPluginByKey(key);
  if (existing) {
    const installation = await getInstallation(organizationId, existing.id);
    if (installation) {
      throw new ConflictError(`Plugin "${manifest.id}" is already installed. Use upgrade to update it.`);
    }
  }

  const plugin = await upsertPlugin({
    key,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author ?? null,
    description: manifest.description ?? null,
    manifest: manifest as unknown as Prisma.InputJsonValue,
  });
  const installation = await upsertInstallation({
    organizationId,
    pluginId: plugin.id,
    pluginKey: key,
    version: manifest.version,
    grantedScopes: manifest.permissions,
    status: 'ENABLED',
    installedById: userId,
  });
  return toView(plugin, installation);
}

export async function upgradePluginService(manifestId: string, manifestInput: unknown): Promise<PluginView> {
  const { organizationId, userId } = await requireAdminOrg();
  const manifest = validateManifest(manifestInput);
  if (manifest.id !== manifestId) {
    throw new ValidationError('The manifest id does not match the plugin being upgraded.');
  }
  const { plugin: existing, installation: current } = await resolveInstalled(organizationId, manifestId);

  const plugin = await upsertPlugin({
    key: existing.key,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author ?? null,
    description: manifest.description ?? null,
    manifest: manifest as unknown as Prisma.InputJsonValue,
  });
  const installation = await upsertInstallation({
    organizationId,
    pluginId: plugin.id,
    pluginKey: existing.key,
    version: manifest.version,
    grantedScopes: manifest.permissions,
    status: current.status,
    installedById: userId,
  });
  return toView(plugin, installation);
}

async function setStatus(manifestId: string, status: 'ENABLED' | 'DISABLED'): Promise<PluginView> {
  const { organizationId } = await requireAdminOrg();
  const { plugin } = await resolveInstalled(organizationId, manifestId);
  const installation = await setInstallationStatus(organizationId, plugin.id, status);
  if (!installation) throw new NotFoundError('Plugin is not installed.');
  return toView(plugin, installation);
}

export function enablePluginService(manifestId: string): Promise<PluginView> {
  return setStatus(manifestId, 'ENABLED');
}

export function disablePluginService(manifestId: string): Promise<PluginView> {
  return setStatus(manifestId, 'DISABLED');
}

export async function uninstallPluginService(manifestId: string): Promise<void> {
  const { organizationId } = await requireAdminOrg();
  const { plugin } = await resolveInstalled(organizationId, manifestId);
  await deleteInstallation(organizationId, plugin.id);
}

// ── Runtime (isolation-aware contribution resolver) ─────────────────────────

export interface PluginContribution {
  pluginId: string;
  name: string;
  grantedScopes: string[];
  components: { slot: PluginComponentSlot; name: string; url?: string }[];
  hooks: { event: string; url?: string }[];
}

/**
 * Resolve the contributions of an org's ENABLED plugins only, each carrying the
 * exact scopes it was granted. This is the single point the UI (slots) and the
 * event system (hooks) read from — a disabled or uninstalled plugin contributes
 * nothing, and no plugin is ever visible outside its own organization.
 */
export async function resolveEnabledPluginContributions(organizationId: string): Promise<PluginContribution[]> {
  const installations = await listEnabledInstallations(organizationId);
  const plugins = await getPluginsByIds(installations.map((installation) => installation.pluginId));
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  return installations
    .map((installation) => {
      const plugin = byId.get(installation.pluginId);
      if (!plugin) return null;
      const manifest = manifestOf(plugin);
      return {
        pluginId: manifest.id,
        name: plugin.name,
        grantedScopes: installation.grantedScopes,
        components: manifest.components,
        hooks: manifest.hooks,
      } satisfies PluginContribution;
    })
    .filter((contribution): contribution is PluginContribution => contribution !== null);
}
