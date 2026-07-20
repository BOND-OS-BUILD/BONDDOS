import { requireRole } from '@bond-os/auth';
import { listToolExecutions, type ToolExecutionData } from '@bond-os/database';
import { ROLES, type ExecutionListQuery, type PaginatedResult } from '@bond-os/shared';

/**
 * Read-only listing behind the execution-history admin page (Phase 6) —
 * lets an org member see past tool executions and their outcomes outside of
 * the Mr. Bond chat UI, for accountability/debugging. See docs/tool-execution.md.
 */
export async function listExecutionsService(
  organizationId: string,
  query: ExecutionListQuery,
): Promise<PaginatedResult<ToolExecutionData>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listToolExecutions({ organizationId, ...query });
}
