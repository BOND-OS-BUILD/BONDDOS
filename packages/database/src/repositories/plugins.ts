import type { Prisma, PluginStatus } from '../generated';
import { prisma } from '../client';

/**
 * Phase 11 — plugin registry + per-organization installations. A `Plugin` row
 * is the registered definition (keyed `<orgId>.<manifestId>` so plugins are
 * org-isolated by construction); a `PluginInstallation` links an org to a
 * plugin with the scopes it was granted and its lifecycle status. All plugin
 * behaviour is declarative (the manifest) — nothing here executes plugin code.
 */

export interface PluginRecord {
  id: string;
  key: string;
  name: string;
  version: string;
  author: string | null;
  description: string | null;
  manifest: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertPluginData {
  key: string;
  name: string;
  version: string;
  author?: string | null;
  description?: string | null;
  manifest: Prisma.InputJsonValue;
}

export function upsertPlugin(data: UpsertPluginData): Promise<PluginRecord> {
  return prisma.plugin.upsert({
    where: { key: data.key },
    create: {
      key: data.key,
      name: data.name,
      version: data.version,
      author: data.author ?? null,
      description: data.description ?? null,
      manifest: data.manifest,
    },
    update: {
      name: data.name,
      version: data.version,
      author: data.author ?? null,
      description: data.description ?? null,
      manifest: data.manifest,
    },
  });
}

export function getPluginByKey(key: string): Promise<PluginRecord | null> {
  return prisma.plugin.findUnique({ where: { key } });
}

export interface PluginInstallationRecord {
  id: string;
  organizationId: string;
  pluginId: string;
  pluginKey: string;
  status: PluginStatus;
  version: string;
  config: Prisma.JsonValue | null;
  grantedScopes: string[];
  installedById: string | null;
  installedAt: Date;
  updatedAt: Date;
}

export interface UpsertInstallationData {
  organizationId: string;
  pluginId: string;
  pluginKey: string;
  version: string;
  grantedScopes: string[];
  status: PluginStatus;
  installedById?: string | null;
}

export function upsertInstallation(data: UpsertInstallationData): Promise<PluginInstallationRecord> {
  return prisma.pluginInstallation.upsert({
    where: { organizationId_pluginId: { organizationId: data.organizationId, pluginId: data.pluginId } },
    create: {
      organizationId: data.organizationId,
      pluginId: data.pluginId,
      pluginKey: data.pluginKey,
      version: data.version,
      grantedScopes: data.grantedScopes,
      status: data.status,
      installedById: data.installedById ?? null,
    },
    update: {
      pluginKey: data.pluginKey,
      version: data.version,
      grantedScopes: data.grantedScopes,
      status: data.status,
    },
  });
}

export function getInstallation(organizationId: string, pluginId: string): Promise<PluginInstallationRecord | null> {
  return prisma.pluginInstallation.findUnique({
    where: { organizationId_pluginId: { organizationId, pluginId } },
  });
}

export function listInstallations(organizationId: string): Promise<PluginInstallationRecord[]> {
  return prisma.pluginInstallation.findMany({
    where: { organizationId },
    orderBy: { installedAt: 'desc' },
  });
}

export function listEnabledInstallations(organizationId: string): Promise<PluginInstallationRecord[]> {
  return prisma.pluginInstallation.findMany({
    where: { organizationId, status: 'ENABLED' },
  });
}

export async function setInstallationStatus(
  organizationId: string,
  pluginId: string,
  status: PluginStatus,
): Promise<PluginInstallationRecord | null> {
  const result = await prisma.pluginInstallation.updateMany({
    where: { organizationId, pluginId },
    data: { status },
  });
  if (result.count === 0) return null;
  return getInstallation(organizationId, pluginId);
}

export async function deleteInstallation(organizationId: string, pluginId: string): Promise<boolean> {
  const result = await prisma.pluginInstallation.deleteMany({ where: { organizationId, pluginId } });
  return result.count > 0;
}

/** Fetch the plugin definitions referenced by a set of installations. */
export function getPluginsByIds(ids: string[]): Promise<PluginRecord[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return prisma.plugin.findMany({ where: { id: { in: ids } } });
}
