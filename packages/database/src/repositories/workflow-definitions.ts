import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { Prisma, TriggerType, WorkflowDefinitionStatus } from '../generated/index.js';

/**
 * Organization-authored workflow definitions (Phase 8). Unlike `Tool`/`Agent`
 * (globally-registered developer code), a `WorkflowDefinition` is genuinely
 * per-organization user data built via the visual builder — every function
 * here takes `organizationId`, unlike `tools.ts`/`agents.ts`. A `DRAFT` row
 * mutates in place (`updateDraftWorkflowDefinition`); publishing freezes an
 * immutable, versioned `ACTIVE` row (`publishWorkflowDefinition`) so an
 * in-flight `WorkflowRun` always resumes against the exact graph it started
 * with. See docs/workflows.md.
 */

export interface WorkflowDefinitionData {
  id: string;
  organizationId: string;
  workflowKey: string;
  version: string;
  name: string;
  description: string;
  status: WorkflowDefinitionStatus;
  ownerId: string | null;
  triggerType: TriggerType;
  trigger: unknown;
  conditions: unknown;
  graph: unknown;
  retryPolicy: unknown;
  timeoutMs: number | null;
  rollbackPolicy: unknown;
  webhookSecret: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateWorkflowDefinitionData {
  organizationId: string;
  workflowKey: string;
  version: string;
  name: string;
  description: string;
  ownerId?: string | null;
  triggerType: TriggerType;
  trigger: Prisma.InputJsonValue;
  conditions?: Prisma.InputJsonValue;
  graph: Prisma.InputJsonValue;
  retryPolicy?: Prisma.InputJsonValue;
  timeoutMs?: number | null;
  rollbackPolicy?: Prisma.InputJsonValue;
  webhookSecret?: string | null;
}

/** Always created as `DRAFT` — see `publishWorkflowDefinition` for the only path to `ACTIVE`. */
export async function createWorkflowDefinition(data: CreateWorkflowDefinitionData): Promise<WorkflowDefinitionData> {
  return prisma.workflowDefinition.create({ data: { ...data, status: 'DRAFT' } });
}

export async function getWorkflowDefinitionById(id: string, organizationId: string): Promise<WorkflowDefinitionData | null> {
  return prisma.workflowDefinition.findFirst({ where: { id, organizationId } });
}

/**
 * Deliberately unscoped — the one exception mirroring `workflow-schedules.ts`'s
 * `listDueWorkflowSchedules`. The inbound webhook route has no
 * organizationId to scope by (that's what it's resolving); safety instead
 * comes from `id` being a non-guessable cuid AND the caller still having to
 * pass HMAC signature verification against that specific
 * `WorkflowDefinition.webhookSecret` before anything happens — the same
 * "semi-public identifier + signature" shape most third-party webhook
 * providers use. Never call this from a per-org service.
 */
export async function getWorkflowDefinitionByIdUnscoped(id: string): Promise<WorkflowDefinitionData | null> {
  return prisma.workflowDefinition.findUnique({ where: { id } });
}

export async function getWorkflowDefinitionByKeyVersion(
  organizationId: string,
  workflowKey: string,
  version: string,
): Promise<WorkflowDefinitionData | null> {
  return prisma.workflowDefinition.findUnique({
    where: { organizationId_workflowKey_version: { organizationId, workflowKey, version } },
  });
}

/** Highest-version `ACTIVE` row for a `workflowKey` — used when a caller doesn't pin a specific version. */
export async function getLatestActiveWorkflowDefinition(
  organizationId: string,
  workflowKey: string,
): Promise<WorkflowDefinitionData | null> {
  return prisma.workflowDefinition.findFirst({
    where: { organizationId, workflowKey, status: 'ACTIVE' },
    orderBy: { version: 'desc' },
  });
}

export interface ListWorkflowDefinitionsFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  status?: WorkflowDefinitionStatus;
  triggerType?: TriggerType;
}

export async function listWorkflowDefinitions(filters: ListWorkflowDefinitionsFilters): Promise<PaginatedResult<WorkflowDefinitionData>> {
  const { organizationId, page, pageSize, status, triggerType } = filters;
  const where = { organizationId, ...(status && { status }), ...(triggerType && { triggerType }) };

  const [items, total] = await Promise.all([
    prisma.workflowDefinition.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.workflowDefinition.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

/** Every `ACTIVE` definition matching a trigger type for one organization — what the Event Bus matches candidates against. */
export async function listActiveWorkflowDefinitionsForTrigger(
  organizationId: string,
  triggerType: TriggerType,
): Promise<WorkflowDefinitionData[]> {
  return prisma.workflowDefinition.findMany({ where: { organizationId, status: 'ACTIVE', triggerType } });
}

export interface UpdateDraftWorkflowDefinitionData {
  name?: string;
  description?: string;
  triggerType?: TriggerType;
  trigger?: Prisma.InputJsonValue;
  conditions?: Prisma.InputJsonValue;
  graph?: Prisma.InputJsonValue;
  retryPolicy?: Prisma.InputJsonValue;
  timeoutMs?: number | null;
  rollbackPolicy?: Prisma.InputJsonValue;
  webhookSecret?: string | null;
}

/** Only ever touches a `DRAFT` row — the `status: 'DRAFT'` filter is what makes an attempt to edit a published `ACTIVE` definition a no-op (0 rows) rather than a mutation. Returns whether a row was actually updated. */
export async function updateDraftWorkflowDefinition(
  id: string,
  organizationId: string,
  data: UpdateDraftWorkflowDefinitionData,
): Promise<boolean> {
  const result = await prisma.workflowDefinition.updateMany({ where: { id, organizationId, status: 'DRAFT' }, data });
  return result.count > 0;
}

/** `DRAFT` -> `ACTIVE`, the only transition that freezes a definition's graph/trigger/conditions from further in-place edits. */
export async function publishWorkflowDefinition(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.workflowDefinition.updateMany({
    where: { id, organizationId, status: 'DRAFT' },
    data: { status: 'ACTIVE' },
  });
  return result.count > 0;
}

export async function disableWorkflowDefinition(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.workflowDefinition.updateMany({
    where: { id, organizationId, status: 'ACTIVE' },
    data: { status: 'DISABLED' },
  });
  return result.count > 0;
}
