import { appendAuditEvent, listAuditEvents, type AuditEventItem, type Prisma } from '@bond-os/database';
import { requireRole } from '@bond-os/auth';
import { ROLES, type PaginatedResult } from '@bond-os/shared';

/**
 * The immutable, append-only compliance trail for the Tool Execution
 * Framework's write lifecycle (Phase 6) — mirrors `TimelineEvent`'s "never
 * edited or deleted" convention. See docs/tool-execution.md.
 */
export class AuditService {
  async record(
    organizationId: string,
    action: string,
    options: { executionId?: string | null; userId?: string | null; metadata?: Record<string, unknown> } = {},
  ): Promise<void> {
    await appendAuditEvent({
      organizationId,
      action,
      executionId: options.executionId,
      userId: options.userId,
      metadata: options.metadata as Prisma.InputJsonValue | undefined,
    });
  }

  async listForExecution(
    organizationId: string,
    executionId: string,
    query: { page: number; pageSize: number },
  ): Promise<PaginatedResult<AuditEventItem>> {
    await requireRole(organizationId, ROLES.MEMBER);
    return listAuditEvents({ organizationId, executionId, ...query });
  }
}
