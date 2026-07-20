import { z } from 'zod';

import { paginationQuerySchema } from './query';

/** Phase 8 "Workflow Automation Platform" — request validation for the Workflows API surface. See docs/workflows.md. */

export const TRIGGER_TYPES = [
  'ENTITY_CREATED',
  'ENTITY_UPDATED',
  'ENTITY_DELETED',
  'FILE_UPLOADED',
  'MANUAL',
  'SCHEDULED',
  'WEBHOOK',
  'API',
  'AGENT_EVENT',
  'AI_INSIGHT',
] as const;
export const triggerTypeSchema = z.enum(TRIGGER_TYPES);

export const WORKFLOW_DEFINITION_STATUSES = ['DRAFT', 'ACTIVE', 'DISABLED'] as const;
export const workflowDefinitionStatusSchema = z.enum(WORKFLOW_DEFINITION_STATUSES);

export const WORKFLOW_RUN_STATUSES = [
  'PENDING',
  'RUNNING',
  'WAITING_APPROVAL',
  'WAITING_TIMER',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'ROLLED_BACK',
] as const;
export const workflowRunStatusSchema = z.enum(WORKFLOW_RUN_STATUSES);

const workflowStepSchema = z.object({
  key: z.string().min(1),
  stepType: z.enum(['READ_DATA', 'SEARCH_KNOWLEDGE', 'INVOKE_AGENT', 'INVOKE_TOOL', 'WAIT', 'BRANCH', 'DELAY', 'LOOP', 'NOTIFICATION', 'GENERATE_REPORT']),
  params: z.record(z.unknown()),
  dependsOn: z.array(z.string().min(1)).default([]),
  condition: z.object({ predicate: z.string().min(1), args: z.record(z.unknown()), negate: z.boolean().optional() }).optional(),
  retry: z.object({ maxAttempts: z.number().int().min(1).max(5), backoffMs: z.number().int().min(0).max(60_000) }).optional(),
});

export const workflowGraphSchema = z.object({ steps: z.array(workflowStepSchema).min(1) });

export const createWorkflowDefinitionSchema = z.object({
  workflowKey: z.string().trim().min(1).max(100),
  version: z.string().trim().min(1).max(20).default('1'),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).default(''),
  ownerId: z.string().min(1).optional(),
  triggerType: triggerTypeSchema,
  trigger: z.record(z.unknown()),
  conditions: z.record(z.unknown()).optional(),
  graph: workflowGraphSchema,
  retryPolicy: z.record(z.unknown()).optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  rollbackPolicy: z.record(z.unknown()).optional(),
});
export type CreateWorkflowDefinitionInput = z.infer<typeof createWorkflowDefinitionSchema>;

export const updateDraftWorkflowDefinitionSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  triggerType: triggerTypeSchema.optional(),
  trigger: z.record(z.unknown()).optional(),
  conditions: z.record(z.unknown()).optional(),
  graph: workflowGraphSchema.optional(),
  retryPolicy: z.record(z.unknown()).optional(),
  timeoutMs: z.coerce.number().int().positive().nullable().optional(),
  rollbackPolicy: z.record(z.unknown()).optional(),
});
export type UpdateDraftWorkflowDefinitionInput = z.infer<typeof updateDraftWorkflowDefinitionSchema>;

export const workflowDefinitionListQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  status: workflowDefinitionStatusSchema.optional(),
  triggerType: triggerTypeSchema.optional(),
});
export type WorkflowDefinitionListQuery = z.infer<typeof workflowDefinitionListQuerySchema>;

export const workflowRunListQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  status: workflowRunStatusSchema.optional(),
  workflowDefinitionId: z.string().min(1).optional(),
});
export type WorkflowRunListQuery = z.infer<typeof workflowRunListQuerySchema>;

export const triggerManualWorkflowSchema = z.object({
  payload: z.record(z.unknown()).default({}),
});
export type TriggerManualWorkflowInput = z.infer<typeof triggerManualWorkflowSchema>;

export const workflowEventListQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  eventType: z.string().min(1).optional(),
  source: z.string().min(1).optional(),
});
export type WorkflowEventListQuery = z.infer<typeof workflowEventListQuerySchema>;

export const instantiateWorkflowTemplateSchema = z.object({
  templateKey: z.string().min(1),
  workflowKey: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200).optional(),
});
export type InstantiateWorkflowTemplateInput = z.infer<typeof instantiateWorkflowTemplateSchema>;
