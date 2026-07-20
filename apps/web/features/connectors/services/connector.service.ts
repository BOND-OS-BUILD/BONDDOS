import { requireRole } from '@bond-os/auth';
import { CONNECTOR_CATALOG, type ConnectorProviderId } from '@bond-os/connectors';
import {
  deleteConnector,
  listConnectors,
  upsertConnector,
  type ConnectorSummary,
} from '@bond-os/database';
import { NotFoundError, ROLES } from '@bond-os/shared';

export interface ConnectorCatalogItem {
  provider: ConnectorProviderId;
  displayName: string;
  description: string;
  connector: ConnectorSummary | null;
}

/** Merges the static provider catalog with the org's actual connector rows, so the UI can show every provider — including ones never connected. */
export async function listConnectorsService(organizationId: string): Promise<ConnectorCatalogItem[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  const connectors = await listConnectors(organizationId);
  const byProvider = new Map(connectors.map((connector) => [connector.provider, connector]));

  return CONNECTOR_CATALOG.map((entry) => ({
    ...entry,
    connector: byProvider.get(entry.provider) ?? null,
  }));
}

export async function connectConnectorService(
  organizationId: string,
  userId: string,
  provider: ConnectorProviderId,
): Promise<ConnectorSummary> {
  await requireRole(organizationId, ROLES.MEMBER);
  return upsertConnector({ organizationId, provider, connectedById: userId });
}

export async function disconnectConnectorService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const deleted = await deleteConnector(id, organizationId);
  if (!deleted) throw new NotFoundError('Connector not found.');
}
