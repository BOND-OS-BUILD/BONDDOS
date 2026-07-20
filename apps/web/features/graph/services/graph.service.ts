import { requireRole } from '@bond-os/auth';
import {
  createRelationship,
  deleteRelationship,
  findConnectedEntities,
  findShortestPath,
  getGraphAnalytics,
  getNeighbors,
  getNode,
  getOrganizationTimeline,
  getTimeline,
  listAllRelationships,
  listRelationships,
  prisma,
  searchEntities,
  type ConnectedEntity,
  type GraphAnalytics,
  type GraphNode,
  type GraphNodeType,
  type NeighborEdge,
  type RelationshipEdge,
  type RelationshipType,
} from '@bond-os/database';
import { NotFoundError, ROLES, ValidationError, type PaginatedResult } from '@bond-os/shared';
import { getCache } from '@bond-os/shared/server';

const NEIGHBORS_CACHE_TTL_SECONDS = 30;
const ANALYTICS_CACHE_TTL_SECONDS = 30;

export async function getNodeService(
  organizationId: string,
  type: GraphNodeType,
  id: string,
): Promise<GraphNode> {
  await requireRole(organizationId, ROLES.MEMBER);
  const node = await getNode(type, id, organizationId);
  if (!node) throw new NotFoundError('Node not found.');
  return node;
}

export interface EntityDetail extends GraphNode {
  relationships: { outgoing: RelationshipEdge[]; incoming: RelationshipEdge[] };
  timeline: PaginatedResult<Awaited<ReturnType<typeof getTimeline>>['items'][number]>;
}

/** Full detail for the Entity Viewer page: the node itself + every relationship + the first page of its timeline. Entities only — Folder/Tag nodes go through `getNodeService`. */
export async function getEntityDetailService(organizationId: string, id: string): Promise<EntityDetail> {
  await requireRole(organizationId, ROLES.MEMBER);

  const entity = await prisma.entity.findFirst({ where: { id, organizationId } });
  if (!entity) throw new NotFoundError('Entity not found.');

  const resolved: GraphNode = {
    id: entity.id,
    type: entity.entityType,
    title: entity.title,
    description: entity.description,
    metadata: entity.metadata,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };

  const [relationships, timeline] = await Promise.all([
    listRelationships(id, organizationId),
    getTimeline(id, { organizationId, page: 1, pageSize: 20 }),
  ]);

  return { ...resolved, relationships, timeline };
}

export async function getNeighborsService(organizationId: string, entityId: string): Promise<NeighborEdge[]> {
  await requireRole(organizationId, ROLES.MEMBER);

  const cache = getCache();
  const cacheKey = `graph:neighbors:${organizationId}:${entityId}`;
  const cached = await cache.get<NeighborEdge[]>(cacheKey);
  if (cached) return cached;

  const neighbors = await getNeighbors(entityId, organizationId);
  await cache.set(cacheKey, neighbors, NEIGHBORS_CACHE_TTL_SECONDS);
  return neighbors;
}

export async function findShortestPathService(
  organizationId: string,
  fromId: string,
  toId: string,
): Promise<string[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  const path = await findShortestPath(fromId, toId, organizationId);
  if (!path) throw new NotFoundError('No path found between these entities.');
  return path;
}

export async function findConnectedEntitiesService(
  organizationId: string,
  entityId: string,
  maxDepth?: number,
): Promise<ConnectedEntity[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  return findConnectedEntities(entityId, organizationId, maxDepth);
}

export async function getGraphAnalyticsService(organizationId: string): Promise<GraphAnalytics> {
  await requireRole(organizationId, ROLES.MEMBER);

  const cache = getCache();
  const cacheKey = `graph:analytics:${organizationId}`;
  const cached = await cache.get<GraphAnalytics>(cacheKey);
  if (cached) return cached;

  const analytics = await getGraphAnalytics(organizationId);
  await cache.set(cacheKey, analytics, ANALYTICS_CACHE_TTL_SECONDS);
  return analytics;
}

export interface ListRelationshipsQuery {
  page: number;
  pageSize: number;
  relationshipType?: RelationshipType;
}

export async function listRelationshipsService(
  organizationId: string,
  query: ListRelationshipsQuery,
): Promise<PaginatedResult<RelationshipEdge>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listAllRelationships({ organizationId, ...query });
}

export interface CreateRelationshipInput {
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: RelationshipType;
  confidence?: number;
}

/** Manual relationship creation (the API path for the 10 relationship types automatic detection doesn't cover — see docs/relationships.md). */
export async function createRelationshipService(
  organizationId: string,
  userId: string,
  input: CreateRelationshipInput,
): Promise<RelationshipEdge> {
  await requireRole(organizationId, ROLES.MEMBER);

  const [source, target] = await Promise.all([
    prisma.entity.findFirst({ where: { id: input.sourceEntityId, organizationId } }),
    prisma.entity.findFirst({ where: { id: input.targetEntityId, organizationId } }),
  ]);
  if (!source || !target) throw new NotFoundError('Source or target entity not found.');

  const created = await createRelationship({ organizationId, createdById: userId, ...input });
  if (!created) throw new ValidationError('That relationship already exists.');
  return created;
}

export async function deleteRelationshipService(organizationId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.ADMIN);
  const deleted = await deleteRelationship(id, organizationId);
  if (!deleted) throw new NotFoundError('Relationship not found.');
}

export interface TimelineQuery {
  page: number;
  pageSize: number;
}

export async function getTimelineService(organizationId: string, entityId: string, query: TimelineQuery) {
  await requireRole(organizationId, ROLES.MEMBER);
  return getTimeline(entityId, { organizationId, ...query });
}

export async function getOrganizationTimelineService(organizationId: string, query: TimelineQuery) {
  await requireRole(organizationId, ROLES.MEMBER);
  return getOrganizationTimeline({ organizationId, ...query });
}

export interface GraphSearchResults {
  entities: Awaited<ReturnType<typeof searchEntities>>;
  relationships: RelationshipEdge[];
  timeline: Awaited<ReturnType<typeof getOrganizationTimeline>>['items'];
}

/** Graph-page-specific search — entities (reusing Phase 2's FTS) plus relationships and timeline events, which the main `/search` intentionally doesn't cover. */
export async function searchGraphService(organizationId: string, q: string): Promise<GraphSearchResults> {
  await requireRole(organizationId, ROLES.MEMBER);

  const [entities, relationships, timelineEvents] = await Promise.all([
    searchEntities(organizationId, q, 10),
    prisma.relationship.findMany({
      where: {
        organizationId,
        OR: [
          { sourceEntity: { title: { contains: q, mode: 'insensitive' } } },
          { targetEntity: { title: { contains: q, mode: 'insensitive' } } },
        ],
      },
      include: {
        sourceEntity: { select: { id: true, title: true, entityType: true } },
        targetEntity: { select: { id: true, title: true, entityType: true } },
      },
      take: 10,
    }),
    prisma.timelineEvent.findMany({
      where: { organizationId, description: { contains: q, mode: 'insensitive' } },
      include: { entity: { select: { id: true, title: true, entityType: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  return { entities, relationships, timeline: timelineEvents };
}
