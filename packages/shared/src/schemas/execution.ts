import { z } from 'zod';

import { paginationQuerySchema } from './query';

/** Phase 6 "Tool Execution Framework" — request validation for the Planner/Execution API surface. See docs/tool-execution.md. */

export const retryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(5),
  backoffMs: z.number().int().min(0).max(60_000),
});

export const rawStepRequestSchema = z.object({
  key: z.string().min(1),
  toolKey: z.string().min(1),
  version: z.string().min(1).optional(),
  params: z.record(z.unknown()),
  dependsOn: z.array(z.string().min(1)).default([]),
  retry: retryPolicySchema.optional(),
});
export type RawStepRequestInput = z.infer<typeof rawStepRequestSchema>;

/** The already-parsed shape both `/api/execution/plan` and Mr. Bond's in-pipeline `<<ACTION:...>>` marker handling feed to `PlannerService.buildPlan()`. */
export const planRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('single'),
    toolKey: z.string().min(1),
    version: z.string().min(1).optional(),
    params: z.record(z.unknown()),
  }),
  z.object({
    kind: z.literal('compound'),
    summary: z.string().min(1),
    steps: z.array(rawStepRequestSchema).min(1),
  }),
]);
export type PlanRequestInput = z.infer<typeof planRequestSchema>;

export const executionAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ExecutionAuditQuery = z.infer<typeof executionAuditQuerySchema>;

/** Mirrors the Prisma `ExecutionStatus` enum in @bond-os/database (kept independent to avoid a shared->database dependency). */
export const EXECUTION_STATUSES = [
  'DRAFT',
  'AWAITING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED',
  'ROLLING_BACK',
  'ROLLED_BACK',
  'CANCELLED',
] as const;
export const executionStatusSchema = z.enum(EXECUTION_STATUSES);
export type ExecutionStatusInput = z.infer<typeof executionStatusSchema>;

/** Query params for `GET /api/execution` — the execution-history admin list (Phase 6). */
export const executionListQuerySchema = paginationQuerySchema
  .pick({ page: true, pageSize: true })
  .extend({
    status: executionStatusSchema.optional(),
  });
export type ExecutionListQuery = z.infer<typeof executionListQuerySchema>;
