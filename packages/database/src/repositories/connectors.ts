import { prisma } from '../client';
import type { ConnectorProvider, ConnectorStatus } from '../generated/index.js';
import { toUserSummaryOrNull, userSummarySelect, type UserSummary } from './shared';

export interface ConnectorSummary {
  id: string;
  provider: ConnectorProvider;
  status: ConnectorStatus;
  connectedBy: UserSummary | null;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toSummary(connector: {
  id: string;
  provider: ConnectorProvider;
  status: ConnectorStatus;
  connectedBy: { id: string; name: string; email: string; image: string | null } | null;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ConnectorSummary {
  return {
    id: connector.id,
    provider: connector.provider,
    status: connector.status,
    connectedBy: toUserSummaryOrNull(connector.connectedBy),
    lastSyncAt: connector.lastSyncAt,
    createdAt: connector.createdAt,
    updatedAt: connector.updatedAt,
  };
}

export async function listConnectors(organizationId: string): Promise<ConnectorSummary[]> {
  const connectors = await prisma.connector.findMany({
    where: { organizationId },
    include: { connectedBy: { select: userSummarySelect } },
    orderBy: { provider: 'asc' },
  });
  return connectors.map(toSummary);
}

export async function getConnectorById(id: string, organizationId: string): Promise<ConnectorSummary | null> {
  const connector = await prisma.connector.findFirst({
    where: { id, organizationId },
    include: { connectedBy: { select: userSummarySelect } },
  });
  return connector ? toSummary(connector) : null;
}

export interface CreateConnectorData {
  organizationId: string;
  provider: ConnectorProvider;
  connectedById?: string | null;
}

/** One connector per (organization, provider) — reconnecting an existing one updates it instead of erroring. */
export async function upsertConnector(data: CreateConnectorData): Promise<ConnectorSummary> {
  const connector = await prisma.connector.upsert({
    where: { organizationId_provider: { organizationId: data.organizationId, provider: data.provider } },
    create: {
      organizationId: data.organizationId,
      provider: data.provider,
      connectedById: data.connectedById,
      status: 'DISCONNECTED',
    },
    update: {},
    include: { connectedBy: { select: userSummarySelect } },
  });
  return toSummary(connector);
}

export async function updateConnectorStatus(
  id: string,
  organizationId: string,
  status: ConnectorStatus,
  lastSyncAt?: Date,
): Promise<boolean> {
  const result = await prisma.connector.updateMany({
    where: { id, organizationId },
    data: { status, ...(lastSyncAt && { lastSyncAt }) },
  });
  return result.count > 0;
}

export async function deleteConnector(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.connector.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
