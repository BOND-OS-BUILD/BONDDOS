import { prisma } from '../client';
import type { Prisma, Role, RollbackSupport, ToolCategory } from '../generated/index.js';

/**
 * Registered-tool metadata (Phase 6). NOT organization-scoped — a
 * registered tool applies to every organization. The tool's actual
 * BEHAVIOR (validate/preview/execute/rollback) lives in code
 * (apps/web/features/tools/) and is never read from this table; these rows
 * exist for Tool Discovery and historical `ToolExecution` display. See
 * docs/tool-execution.md.
 */

export interface ToolMetadata {
  id: string;
  toolKey: string;
  version: string;
  name: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  icon: string;
  minimumRole: Role;
  parametersSchema: unknown;
  outputSchema: unknown;
  supportsRollback: boolean;
  rollbackSupport: RollbackSupport;
  supportsPreview: boolean;
  supportsDryRun: boolean;
  supportsTransactions: boolean;
  requiresApproval: boolean;
  estimatedExecutionMs: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertToolData {
  toolKey: string;
  version: string;
  name: string;
  displayName: string;
  description: string;
  category: ToolCategory;
  icon: string;
  minimumRole: Role;
  parametersSchema: Prisma.InputJsonValue;
  outputSchema: Prisma.InputJsonValue;
  supportsRollback: boolean;
  rollbackSupport: RollbackSupport;
  supportsPreview: boolean;
  supportsDryRun: boolean;
  supportsTransactions: boolean;
  requiresApproval: boolean;
  estimatedExecutionMs: number;
}

/** Idempotent upsert by `[toolKey, version]` — called once per registered tool when `ToolRegistryService` is first constructed each process lifetime. */
export async function upsertTool(data: UpsertToolData): Promise<ToolMetadata> {
  return prisma.tool.upsert({
    where: { toolKey_version: { toolKey: data.toolKey, version: data.version } },
    create: data,
    update: data,
  });
}

export async function listTools(): Promise<ToolMetadata[]> {
  return prisma.tool.findMany({ orderBy: [{ toolKey: 'asc' }, { version: 'desc' }] });
}

export async function getToolByKey(toolKey: string, version: string): Promise<ToolMetadata | null> {
  return prisma.tool.findUnique({ where: { toolKey_version: { toolKey, version } } });
}

export async function getToolById(id: string): Promise<ToolMetadata | null> {
  return prisma.tool.findUnique({ where: { id } });
}
