import { prisma } from '../client';
import type { EntityType } from '../generated/index.js';
import { listRelationships } from './relationships';

/**
 * Graph query primitives: node resolution, neighbor loading, bounded BFS
 * (shortest path / connected entities), and org-wide analytics aggregates.
 * All plain Prisma queries + in-process BFS — no AI, no external graph DB.
 * See docs/knowledge-graph.md.
 */

/** 12 of the spec's 14 node types are `Entity` rows; FOLDER/TAG are Phase 2's own standalone tables, exposed read-only here. */
export type GraphNodeType = EntityType | 'FOLDER' | 'TAG';

export interface GraphNode {
  id: string;
  type: GraphNodeType;
  title: string;
  description: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export async function getNode(type: GraphNodeType, id: string, organizationId: string): Promise<GraphNode | null> {
  if (type === 'FOLDER') {
    const folder = await prisma.folder.findFirst({ where: { id, organizationId } });
    if (!folder) return null;
    return {
      id: folder.id,
      type: 'FOLDER',
      title: folder.name,
      description: null,
      metadata: null,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    };
  }

  if (type === 'TAG') {
    const tag = await prisma.tag.findFirst({ where: { id, organizationId } });
    if (!tag) return null;
    return {
      id: tag.id,
      type: 'TAG',
      title: tag.name,
      description: null,
      metadata: null,
      createdAt: tag.createdAt,
      updatedAt: tag.createdAt,
    };
  }

  const entity = await prisma.entity.findFirst({ where: { id, organizationId, entityType: type } });
  if (!entity) return null;
  return {
    id: entity.id,
    type: entity.entityType,
    title: entity.title,
    description: entity.description,
    metadata: entity.metadata,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}

export interface NeighborEdge {
  relationshipId: string;
  relationshipType: string;
  confidence: number;
  direction: 'outgoing' | 'incoming';
  node: { id: string; type: string; title: string };
}

/**
 * One entity's immediate neighborhood — real `Relationship` edges plus
 * Phase 2's existing `EntityTag` rows synthesized as `TAGGED_WITH` edges (not
 * duplicated into the `Relationship` table). Used by React Flow's
 * expand-on-click.
 */
export async function getNeighbors(entityId: string, organizationId: string): Promise<NeighborEdge[]> {
  const { outgoing, incoming } = await listRelationships(entityId, organizationId);

  const edges: NeighborEdge[] = [
    ...outgoing.map((rel) => ({
      relationshipId: rel.id,
      relationshipType: rel.relationshipType,
      confidence: rel.confidence,
      direction: 'outgoing' as const,
      node: { id: rel.targetEntity.id, type: rel.targetEntity.entityType, title: rel.targetEntity.title },
    })),
    ...incoming.map((rel) => ({
      relationshipId: rel.id,
      relationshipType: rel.relationshipType,
      confidence: rel.confidence,
      direction: 'incoming' as const,
      node: { id: rel.sourceEntity.id, type: rel.sourceEntity.entityType, title: rel.sourceEntity.title },
    })),
  ];

  const entityTags = await prisma.entityTag.findMany({
    where: { entityId },
    include: { tag: { select: { id: true, name: true } } },
  });
  for (const entityTag of entityTags) {
    edges.push({
      relationshipId: `tag:${entityTag.id}`,
      relationshipType: 'TAGGED_WITH',
      confidence: 1,
      direction: 'outgoing',
      node: { id: entityTag.tag.id, type: 'TAG', title: entityTag.tag.name },
    });
  }

  return edges;
}

const MAX_PATH_DEPTH = 6;
const MAX_PATH_VISITED = 500;

/** Level-by-level BFS over `Relationship` (treated as undirected), one batched query per level, capped for performance. */
export async function findShortestPath(
  fromId: string,
  toId: string,
  organizationId: string,
): Promise<string[] | null> {
  if (fromId === toId) return [fromId];

  const visited = new Set<string>([fromId]);
  const parent = new Map<string, string>();
  let frontier = [fromId];

  for (let depth = 0; depth < MAX_PATH_DEPTH && frontier.length > 0; depth++) {
    const edges = await prisma.relationship.findMany({
      where: {
        organizationId,
        OR: [{ sourceEntityId: { in: frontier } }, { targetEntityId: { in: frontier } }],
      },
      select: { sourceEntityId: true, targetEntityId: true },
    });

    const nextFrontier: string[] = [];
    for (const edge of edges) {
      for (const [from, to] of [
        [edge.sourceEntityId, edge.targetEntityId],
        [edge.targetEntityId, edge.sourceEntityId],
      ] as const) {
        if (!frontier.includes(from) || visited.has(to)) continue;
        visited.add(to);
        parent.set(to, from);
        if (to === toId) return reconstructPath(parent, toId, fromId);
        if (visited.size < MAX_PATH_VISITED) nextFrontier.push(to);
      }
    }
    frontier = nextFrontier;
  }

  return null;
}

function reconstructPath(parent: Map<string, string>, toId: string, fromId: string): string[] {
  const path = [toId];
  let current = toId;
  while (current !== fromId) {
    const prev = parent.get(current);
    if (!prev) break;
    path.push(prev);
    current = prev;
  }
  return path.reverse();
}

const MAX_CONNECTED_DEPTH = 3;
const MAX_CONNECTED_NODES = 200;

export interface ConnectedEntity {
  id: string;
  title: string;
  entityType: EntityType;
  depth: number;
}

/** Bounded BFS collecting every entity reachable from `entityId` within `maxDepth` hops, capped at MAX_CONNECTED_NODES for performance. */
export async function findConnectedEntities(
  entityId: string,
  organizationId: string,
  maxDepth = MAX_CONNECTED_DEPTH,
): Promise<ConnectedEntity[]> {
  const visited = new Map<string, number>([[entityId, 0]]);
  let frontier = [entityId];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0 && visited.size < MAX_CONNECTED_NODES; depth++) {
    const edges = await prisma.relationship.findMany({
      where: {
        organizationId,
        OR: [{ sourceEntityId: { in: frontier } }, { targetEntityId: { in: frontier } }],
      },
      select: { sourceEntityId: true, targetEntityId: true },
    });

    const nextFrontier: string[] = [];
    for (const edge of edges) {
      for (const candidate of [edge.sourceEntityId, edge.targetEntityId]) {
        if (visited.has(candidate) || visited.size >= MAX_CONNECTED_NODES) continue;
        visited.set(candidate, depth);
        nextFrontier.push(candidate);
      }
    }
    frontier = nextFrontier;
  }

  visited.delete(entityId);
  const ids = Array.from(visited.keys());
  if (ids.length === 0) return [];

  const entities = await prisma.entity.findMany({
    where: { id: { in: ids }, organizationId },
    select: { id: true, title: true, entityType: true },
  });

  return entities.map((entity) => ({ ...entity, depth: visited.get(entity.id) ?? maxDepth }));
}

export interface GraphAnalytics {
  totalEntities: number;
  totalRelationships: number;
  topConnectedNodes: Array<{ id: string; title: string; entityType: EntityType; connectionCount: number }>;
  recentlyAdded: Array<{ id: string; title: string; entityType: EntityType; createdAt: Date }>;
  relationshipTypeBreakdown: Array<{ relationshipType: string; count: number }>;
  growthOverTime: Array<{ date: string; count: number }>;
}

/** Dashboard-card analytics — plain aggregation (count/groupBy/one date-bucketing raw query), no AI. */
export async function getGraphAnalytics(organizationId: string): Promise<GraphAnalytics> {
  const [totalEntities, totalRelationships, recentlyAdded, relationshipGroups, bySource, byTarget] =
    await Promise.all([
      prisma.entity.count({ where: { organizationId } }),
      prisma.relationship.count({ where: { organizationId } }),
      prisma.entity.findMany({
        where: { organizationId },
        select: { id: true, title: true, entityType: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      prisma.relationship.groupBy({ by: ['relationshipType'], where: { organizationId }, _count: { _all: true } }),
      prisma.relationship.groupBy({ by: ['sourceEntityId'], where: { organizationId }, _count: { _all: true } }),
      prisma.relationship.groupBy({ by: ['targetEntityId'], where: { organizationId }, _count: { _all: true } }),
    ]);

  const connectionCounts = new Map<string, number>();
  for (const row of bySource) {
    connectionCounts.set(row.sourceEntityId, (connectionCounts.get(row.sourceEntityId) ?? 0) + row._count._all);
  }
  for (const row of byTarget) {
    connectionCounts.set(row.targetEntityId, (connectionCounts.get(row.targetEntityId) ?? 0) + row._count._all);
  }

  const topIds = Array.from(connectionCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);

  const topEntities = topIds.length
    ? await prisma.entity.findMany({
        where: { id: { in: topIds }, organizationId },
        select: { id: true, title: true, entityType: true },
      })
    : [];
  const topEntityById = new Map(topEntities.map((entity) => [entity.id, entity]));

  const topConnectedNodes = topIds
    .map((id) => {
      const entity = topEntityById.get(id);
      if (!entity) return null;
      return { ...entity, connectionCount: connectionCounts.get(id) ?? 0 };
    })
    .filter((node): node is NonNullable<typeof node> => node !== null);

  const growthRows = await prisma.$queryRaw<Array<{ date: string; count: bigint }>>`
    SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date, COUNT(*)::bigint AS count
    FROM entities
    WHERE "organizationId" = ${organizationId}
    GROUP BY 1
    ORDER BY 1 ASC
    LIMIT 90
  `;

  return {
    totalEntities,
    totalRelationships,
    topConnectedNodes,
    recentlyAdded,
    relationshipTypeBreakdown: relationshipGroups.map((group) => ({
      relationshipType: group.relationshipType,
      count: group._count._all,
    })),
    growthOverTime: growthRows.map((row) => ({ date: row.date, count: Number(row.count) })),
  };
}
