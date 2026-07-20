import { z } from 'zod';

import { paginationQuerySchema } from './query';

/** Phase 7 "Multi-Agent Architecture" — request validation for the Agents API surface. See docs/agents.md. */

/** The `POST /api/agents/chat` request body — structurally identical to `sendBondMessageSchema`, plus an optional explicit `agentKey`; omitted lets the Coordinator auto-route. */
export const agentChatSchema = z.object({
  conversationId: z.string().min(1).optional(),
  content: z.string().trim().min(1, 'A message is required.').max(8000),
  agentKey: z.string().min(1).optional(),
});
export type AgentChatInput = z.infer<typeof agentChatSchema>;

/** `POST /api/agents/delegate` — explicit admin/debug invocation, also what the Delegation Graph UI's "replay" affordance calls. */
export const delegateRequestSchema = z.object({
  fromAgentKey: z.string().min(1),
  toAgentKey: z.string().min(1),
  message: z.string().trim().min(1).max(8000),
  handoff: z.boolean().default(false),
  conversationId: z.string().min(1).optional(),
});
export type DelegateRequestInput = z.infer<typeof delegateRequestSchema>;

/** `GET /api/agents/context?q=&agentKey=` — introspection only, never generates an answer. */
export const agentContextQuerySchema = z.object({
  q: z.string().trim().min(1).max(8000),
  agentKey: z.string().min(1).optional(),
});
export type AgentContextQuery = z.infer<typeof agentContextQuerySchema>;

export const createGoalSchema = z.object({
  agentKey: z.string().min(1),
  title: z.string().trim().min(1).max(300),
  conversationId: z.string().min(1).optional(),
});
export type CreateGoalInput = z.infer<typeof createGoalSchema>;

export const GOAL_STATUSES = ['ACTIVE', 'WAITING', 'COMPLETED', 'CANCELLED'] as const;
export const goalStatusSchema = z.enum(GOAL_STATUSES);

export const goalListQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  status: goalStatusSchema.optional(),
});
export type GoalListQuery = z.infer<typeof goalListQuerySchema>;

export const INSIGHT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'DISMISSED'] as const;
export const insightStatusSchema = z.enum(INSIGHT_STATUSES);

export const insightListQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  status: insightStatusSchema.optional(),
  agentId: z.string().min(1).optional(),
});
export type InsightListQuery = z.infer<typeof insightListQuerySchema>;

export const updateInsightStatusSchema = z.object({
  status: z.enum(['ACKNOWLEDGED', 'DISMISSED']),
});
export type UpdateInsightStatusInput = z.infer<typeof updateInsightStatusSchema>;

export const AGENT_EVENT_TYPES = [
  'THOUGHT_STARTED',
  'RETRIEVAL',
  'DELEGATION',
  'PLAN',
  'APPROVAL_REQUEST',
  'EXECUTION',
  'COMPLETION',
] as const;
export const agentEventTypeSchema = z.enum(AGENT_EVENT_TYPES);

export const agentTimelineQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  conversationId: z.string().min(1).optional(),
  agentId: z.string().min(1).optional(),
  eventType: agentEventTypeSchema.optional(),
});
export type AgentTimelineQuery = z.infer<typeof agentTimelineQuerySchema>;
