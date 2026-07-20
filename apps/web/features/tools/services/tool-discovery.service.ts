import { requireRole } from '@bond-os/auth';
import { ROLES } from '@bond-os/shared';

import { getToolRegistryService } from '@/features/execution/lib/container';

/**
 * Tool Discovery (spec: "AI must never hardcode tool names. Instead it
 * requests Available Tools -> Capabilities -> Choose Tool -> Return Tool
 * ID."). Maps the live in-memory registry to a plain, serializable shape —
 * a tool's Zod schemas and SDK methods aren't serializable, only its
 * declared metadata is. See docs/tool-execution.md.
 */

export interface AvailableTool {
  toolKey: string;
  version: string;
  name: string;
  displayName: string;
  description: string;
  category: string;
  icon: string;
  minimumRole: string;
  rollbackSupport: string;
  supportsPreview: boolean;
  supportsDryRun: boolean;
  supportsTransactions: boolean;
  requiresApproval: boolean;
  estimatedExecutionMs: number;
}

export async function listToolsService(organizationId: string): Promise<AvailableTool[]> {
  await requireRole(organizationId, ROLES.MEMBER);

  return getToolRegistryService()
    .list()
    .map((tool) => ({
      toolKey: tool.toolKey,
      version: tool.version,
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      category: tool.category,
      icon: tool.icon,
      minimumRole: tool.permissions(),
      rollbackSupport: tool.rollbackSupport,
      supportsPreview: tool.supportsPreview,
      supportsDryRun: tool.supportsDryRun,
      supportsTransactions: tool.supportsTransactions,
      requiresApproval: tool.requiresApproval,
      estimatedExecutionMs: tool.estimatedExecutionMs,
    }));
}
