import { z } from 'zod';

import { paginationQuerySchema } from './query';

export const RELATIONSHIP_TYPES = [
  'WORKS_AT',
  'OWNS',
  'CREATED',
  'MENTIONED_IN',
  'RELATED_TO',
  'PART_OF',
  'BELONGS_TO',
  'REPORTS_TO',
  'ATTENDED',
  'SENT',
  'RECEIVED',
  'REFERENCES',
  'DUPLICATE_OF',
  'TAGGED_WITH',
  'DEPENDS_ON',
] as const;
export const relationshipTypeSchema = z.enum(RELATIONSHIP_TYPES);

/** 12 are `Entity` rows (extended `EntityType`); FOLDER/TAG are Phase 2's own standalone tables, exposed read-only. */
export const GRAPH_NODE_TYPES = [
  'DOCUMENT',
  'MEETING',
  'NOTE',
  'CUSTOMER',
  'EMAIL',
  'CONTACT',
  'WEBSITE',
  'FILE',
  'PERSON',
  'COMPANY',
  'PROJECT',
  'TASK',
  'PRODUCT',
  'EVENT',
  'FOLDER',
  'TAG',
] as const;
export const graphNodeTypeSchema = z.enum(GRAPH_NODE_TYPES);

export const createRelationshipSchema = z.object({
  sourceEntityId: z.string().min(1),
  targetEntityId: z.string().min(1),
  relationshipType: relationshipTypeSchema,
  confidence: z.number().min(0).max(1).optional(),
});
export type CreateRelationshipInput = z.infer<typeof createRelationshipSchema>;

export const relationshipQuerySchema = paginationQuerySchema.extend({
  relationshipType: relationshipTypeSchema.optional(),
});
export type RelationshipQuery = z.infer<typeof relationshipQuerySchema>;

export const nodeQuerySchema = z.object({
  type: graphNodeTypeSchema,
  id: z.string().min(1),
});
export type NodeQuery = z.infer<typeof nodeQuerySchema>;

export const pathQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});
export type PathQuery = z.infer<typeof pathQuerySchema>;

export const timelineQuerySchema = z.object({
  entityId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

export const graphSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Search query is required.'),
});
export type GraphSearchQuery = z.infer<typeof graphSearchQuerySchema>;

export const connectedEntitiesQuerySchema = z.object({
  maxDepth: z.coerce.number().int().min(1).max(6).optional(),
});
export type ConnectedEntitiesQuery = z.infer<typeof connectedEntitiesQuerySchema>;
