import { prisma } from '../client';
import type { EntityType, Prisma } from '../generated/index.js';

/**
 * Entity creation/lookup helpers used by the graph extraction pipeline
 * (`apps/web/features/graph/services`). Distinct from `repositories/
 * entities.ts` (Phase 2's EntityRelationship CRUD) — kept in a new file so
 * nothing Phase 2 shipped needs to change. See docs/knowledge-graph.md.
 */

export interface EntityNodeSummary {
  id: string;
  entityType: EntityType;
  title: string;
  description: string | null;
  metadata: unknown;
}

const entityNodeSelect = {
  id: true,
  entityType: true,
  title: true,
  description: true,
  metadata: true,
} satisfies Prisma.EntitySelect;

export interface CreateSimpleEntityData {
  organizationId: string;
  creatorId?: string | null;
  entityType: EntityType;
  title: string;
  description?: string | null;
  metadata?: Prisma.InputJsonValue;
}

/** Plain Entity row, no detail table — used for COMPANY/PRODUCT/EVENT and soft-linked PROJECT/TASK/MEETING mentions. */
export async function createSimpleEntity(data: CreateSimpleEntityData): Promise<EntityNodeSummary> {
  return prisma.entity.create({
    data: {
      organizationId: data.organizationId,
      creatorId: data.creatorId,
      entityType: data.entityType,
      title: data.title,
      description: data.description,
      metadata: data.metadata,
    },
    select: entityNodeSelect,
  });
}

export interface CreatePersonEntityData {
  organizationId: string;
  creatorId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  jobTitle?: string | null;
}

/** Creates the Entity(PERSON) + Contact pair atomically — the same nested-write pattern `createKnowledgeDocument` uses for Entity+KnowledgeDocument. */
export async function createPersonEntity(data: CreatePersonEntityData): Promise<EntityNodeSummary> {
  return prisma.entity.create({
    data: {
      organizationId: data.organizationId,
      creatorId: data.creatorId,
      entityType: 'PERSON',
      title: data.name,
      contact: {
        create: {
          organizationId: data.organizationId,
          name: data.name,
          email: data.email,
          phone: data.phone,
          company: data.company,
          jobTitle: data.jobTitle,
        },
      },
    },
    select: entityNodeSelect,
  });
}

/** Case-insensitive exact title match within one org+type — dedups COMPANY/PROJECT/TASK/MEETING/PRODUCT/EVENT mentions deterministically. */
export async function findEntityByExactTitle(
  organizationId: string,
  entityType: EntityType,
  title: string,
): Promise<EntityNodeSummary | null> {
  return prisma.entity.findFirst({
    where: { organizationId, entityType, title: { equals: title, mode: 'insensitive' } },
    select: entityNodeSelect,
  });
}

export interface PersonCandidate {
  id: string;
  name: string;
}

/** Every PERSON/CONTACT entity's name in the org — the resolution engine's match pool. See docs/entity-resolution.md. */
export async function listPersonCandidates(organizationId: string): Promise<PersonCandidate[]> {
  const contacts = await prisma.contact.findMany({
    where: { organizationId, entity: { entityType: { in: ['PERSON', 'CONTACT'] } } },
    select: { entityId: true, name: true },
  });
  return contacts.map((contact) => ({ id: contact.entityId, name: contact.name }));
}

export async function getEntityNode(id: string, organizationId: string): Promise<EntityNodeSummary | null> {
  return prisma.entity.findFirst({ where: { id, organizationId }, select: entityNodeSelect });
}

/** Merges new keys into an Entity's existing `metadata` JSON — used to soft-link an extracted PROJECT/MEETING mention to the real Phase 1 record it matches. */
export async function mergeEntityMetadata(
  id: string,
  organizationId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const entity = await prisma.entity.findFirst({ where: { id, organizationId }, select: { metadata: true } });
  if (!entity) return;

  const merged = { ...(entity.metadata as Record<string, unknown> | null), ...patch };
  await prisma.entity.updateMany({
    where: { id, organizationId },
    data: { metadata: merged as Prisma.InputJsonValue },
  });
}
