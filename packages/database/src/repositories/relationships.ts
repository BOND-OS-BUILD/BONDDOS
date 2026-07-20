import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { Prisma, RelationshipType } from '../generated/index.js';

/**
 * CRUD for the Phase 3 `Relationship` model — the typed knowledge-graph edge
 * (source/target/relationshipType/confidence/createdBy). Distinct from
 * Phase 2's `EntityRelationship` (repositories/entities.ts); see
 * docs/relationships.md for why they coexist.
 */

const nodeSelect = { id: true, title: true, entityType: true } as const;

export interface RelationshipEdge {
  id: string;
  relationshipType: RelationshipType;
  confidence: number;
  createdAt: Date;
  sourceEntity: { id: string; title: string; entityType: string };
  targetEntity: { id: string; title: string; entityType: string };
}

export interface CreateRelationshipData {
  organizationId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: RelationshipType;
  confidence?: number;
  createdById?: string | null;
}

/**
 * Idempotent: a self-edge is rejected, and a relationship already covered by
 * the (source, target, type) unique constraint just no-ops (returns null)
 * instead of erroring — the extraction pipeline re-detecting the same
 * relationship on a re-parse shouldn't throw.
 */
export async function createRelationship(data: CreateRelationshipData): Promise<RelationshipEdge | null> {
  if (data.sourceEntityId === data.targetEntityId) return null;

  const existing = await prisma.relationship.findUnique({
    where: {
      sourceEntityId_targetEntityId_relationshipType: {
        sourceEntityId: data.sourceEntityId,
        targetEntityId: data.targetEntityId,
        relationshipType: data.relationshipType,
      },
    },
  });
  if (existing) return null;

  return prisma.relationship.create({
    data: {
      organizationId: data.organizationId,
      sourceEntityId: data.sourceEntityId,
      targetEntityId: data.targetEntityId,
      relationshipType: data.relationshipType,
      confidence: data.confidence ?? 1,
      createdById: data.createdById,
    },
    include: { sourceEntity: { select: nodeSelect }, targetEntity: { select: nodeSelect } },
  });
}

/** Every relationship touching one entity, both directions — two batched queries, not one per neighbor. */
export async function listRelationships(
  entityId: string,
  organizationId: string,
): Promise<{ outgoing: RelationshipEdge[]; incoming: RelationshipEdge[] }> {
  const [outgoing, incoming] = await Promise.all([
    prisma.relationship.findMany({
      where: { sourceEntityId: entityId, organizationId },
      include: { sourceEntity: { select: nodeSelect }, targetEntity: { select: nodeSelect } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.relationship.findMany({
      where: { targetEntityId: entityId, organizationId },
      include: { sourceEntity: { select: nodeSelect }, targetEntity: { select: nodeSelect } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return { outgoing, incoming };
}

/** All relationships touching ANY entity in `entityIds`, in one query — avoids N+1 when loading a neighborhood/path. */
export async function listRelationshipsForEntities(
  entityIds: string[],
  organizationId: string,
): Promise<RelationshipEdge[]> {
  if (entityIds.length === 0) return [];

  return prisma.relationship.findMany({
    where: {
      organizationId,
      OR: [{ sourceEntityId: { in: entityIds } }, { targetEntityId: { in: entityIds } }],
    },
    include: { sourceEntity: { select: nodeSelect }, targetEntity: { select: nodeSelect } },
  });
}

export interface ListAllRelationshipsFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  relationshipType?: RelationshipType;
}

/** Paginated, org-wide — backs the Relationship Explorer page. */
export async function listAllRelationships(
  filters: ListAllRelationshipsFilters,
): Promise<PaginatedResult<RelationshipEdge>> {
  const { organizationId, page, pageSize, relationshipType } = filters;
  const where: Prisma.RelationshipWhereInput = {
    organizationId,
    ...(relationshipType && { relationshipType }),
  };

  const [items, total] = await Promise.all([
    prisma.relationship.findMany({
      where,
      include: { sourceEntity: { select: nodeSelect }, targetEntity: { select: nodeSelect } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.relationship.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function deleteRelationship(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.relationship.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
