import { prisma } from '../client';
import type { Prisma, RollbackRecordStatus } from '../generated/index.js';

/**
 * One row per execution's rollback attempt (Phase 6) — an execution either
 * never needed one, or has exactly one. A failed rollback is recorded,
 * never silently swallowed. `RollbackRecord` has no `organizationId` column
 * of its own; both functions take `organizationId` and verify it through
 * the owning `ToolExecution` relation — defense-in-depth consistent with
 * every other write in this flow, even though today's only caller
 * (`RollbackService`, invoked from `ExecutionService` with an `executionId`
 * it just created itself under the correct org) never actually depends on
 * it. See docs/rollback.md.
 */

export interface RollbackRecordData {
  id: string;
  executionId: string;
  status: RollbackRecordStatus;
  completedAt: Date | null;
  details: unknown;
  createdAt: Date;
}

export async function createRollbackRecord(executionId: string, organizationId: string): Promise<RollbackRecordData> {
  const execution = await prisma.toolExecution.findFirst({ where: { id: executionId, organizationId }, select: { id: true } });
  if (!execution) throw new Error(`ToolExecution "${executionId}" not found in this organization.`);

  return prisma.rollbackRecord.create({ data: { executionId, status: 'PENDING' } });
}

export interface CompleteRollbackRecordData {
  status: Extract<RollbackRecordStatus, 'SUCCEEDED' | 'FAILED'>;
  details?: Prisma.InputJsonValue;
}

export async function completeRollbackRecord(
  executionId: string,
  organizationId: string,
  data: CompleteRollbackRecordData,
): Promise<void> {
  await prisma.rollbackRecord.updateMany({
    where: { executionId, execution: { organizationId } },
    data: { ...data, completedAt: new Date() },
  });
}
