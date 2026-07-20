import { prisma } from '../client';

export interface CreateSourceData {
  organizationId: string;
  connectorId?: string | null;
  name: string;
  externalId?: string | null;
}

/** Represents where a KnowledgeDocument came from — a manual upload has no `connectorId`. */
export function createSource(data: CreateSourceData) {
  return prisma.source.create({ data });
}

export function listSourcesForConnector(connectorId: string, organizationId: string) {
  return prisma.source.findMany({ where: { connectorId, organizationId }, orderBy: { createdAt: 'desc' } });
}
