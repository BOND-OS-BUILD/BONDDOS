import { completeRollbackRecord, createRollbackRecord, type Prisma } from '@bond-os/database';

import type { AnyToolDefinition, ToolContext } from '@/features/tools/lib/tool-definition';
import type { AuditService } from '@/features/audit/services/audit.service';

/**
 * Reverses already-`SUCCEEDED` steps of a failed execution, in reverse
 * completion order — a `RollbackRecord` is written regardless of outcome,
 * and a failed rollback is surfaced, never silently swallowed: partial
 * writes with no automatic way back are a real operational alarm. See
 * docs/rollback.md.
 */

export interface CompletedStepForRollback {
  stepKey: string;
  tool: AnyToolDefinition;
  result: unknown;
}

export interface RollbackOutcome {
  succeeded: boolean;
  details: Array<{ stepKey: string; ok: boolean; error?: string }>;
}

export class RollbackService {
  constructor(private readonly audit: AuditService) {}

  async rollbackSteps(
    ctx: ToolContext,
    executionId: string,
    completedSteps: CompletedStepForRollback[],
  ): Promise<RollbackOutcome> {
    await createRollbackRecord(executionId, ctx.organizationId);

    const details: RollbackOutcome['details'] = [];
    let allOk = true;

    for (const step of [...completedSteps].reverse()) {
      if (step.tool.rollbackSupport === 'NOT_SUPPORTED') {
        allOk = false;
        details.push({ stepKey: step.stepKey, ok: false, error: 'Rollback not supported for this tool.' });
        continue;
      }
      try {
        await step.tool.rollback(ctx, step.result);
        details.push({ stepKey: step.stepKey, ok: true });
      } catch (error) {
        allOk = false;
        details.push({ stepKey: step.stepKey, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }

    await completeRollbackRecord(executionId, ctx.organizationId, {
      status: allOk ? 'SUCCEEDED' : 'FAILED',
      details: details as unknown as Prisma.InputJsonValue,
    });

    await this.audit.record(ctx.organizationId, 'rolled_back', {
      executionId,
      userId: ctx.userId,
      metadata: { succeeded: allOk, details },
    });

    return { succeeded: allOk, details };
  }
}
