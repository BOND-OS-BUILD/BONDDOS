import { prisma } from '../client';

export interface CreateEntityRelationshipData {
  organizationId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
}

export async function createEntityRelationship(data: CreateEntityRelationshipData) {
  return prisma.entityRelationship.create({ data });
}

export interface EntityRelationshipSummary {
  id: string;
  relationType: string;
  entity: { id: string; title: string; entityType: string };
}

/** Every relationship touching an entity, split by direction. */
export async function listEntityRelationships(
  entityId: string,
  organizationId: string,
): Promise<{ outgoing: EntityRelationshipSummary[]; incoming: EntityRelationshipSummary[] }> {
  const entitySelect = { id: true, title: true, entityType: true } as const;

  const [outgoing, incoming] = await Promise.all([
    prisma.entityRelationship.findMany({
      where: { sourceEntityId: entityId, organizationId },
      include: { targetEntity: { select: entitySelect } },
    }),
    prisma.entityRelationship.findMany({
      where: { targetEntityId: entityId, organizationId },
      include: { sourceEntity: { select: entitySelect } },
    }),
  ]);

  return {
    outgoing: outgoing.map((rel) => ({ id: rel.id, relationType: rel.relationType, entity: rel.targetEntity })),
    incoming: incoming.map((rel) => ({ id: rel.id, relationType: rel.relationType, entity: rel.sourceEntity })),
  };
}

export async function deleteEntityRelationship(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.entityRelationship.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}

/** Deletes any Entity (and, via cascade, its detail row/chunks/attachments/tags/relationships). */
export async function deleteEntity(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.entity.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
