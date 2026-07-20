import { requireRole } from '@bond-os/auth';
import {
  createInsight,
  getAgentByKey,
  listInsights,
  updateInsightStatus,
  type InsightData,
  type InsightStatus,
  type InsightType,
} from '@bond-os/database';
import { NotFoundError, ROLES, type PaginatedResult } from '@bond-os/shared';

/**
 * The Insight Engine (Phase 7 spec: "Risks, Missing Information, Conflicts,
 * Duplicates, Recommendations... Never modify data"). This service has
 * exactly one write operation on domain-adjacent state — `status`
 * (acknowledge/dismiss) — and it is bookkeeping on the insight row itself,
 * never a change to a Project/Task/Customer/etc. There is no `record()`
 * call path anywhere that touches a domain table. See docs/insights.md.
 */
export class InsightService {
  async record(
    organizationId: string,
    agentKey: string,
    agentVersion: string,
    input: { type: InsightType; title: string; description: string; relatedEntityIds: string[]; goalId?: string },
  ): Promise<InsightData> {
    await requireRole(organizationId, ROLES.MEMBER);

    const registeredAgent = await getAgentByKey(agentKey, agentVersion);
    if (!registeredAgent) throw new NotFoundError(`Agent "${agentKey}" has not been synced to the database yet.`);

    const created = await createInsight({
      organizationId,
      agentId: registeredAgent.id,
      goalId: input.goalId ?? null,
      type: input.type,
      title: input.title,
      description: input.description,
      relatedEntityIds: input.relatedEntityIds,
    });

    // Dynamically imported, not statically — kept consistent with every
    // other curated publishEvent() call site (see the note in
    // apps/web/features/tasks/services/task.service.ts) even though this
    // specific file isn't on the Tool Registry's import chain today.
    const { publishEvent } = await import('@/features/workflows/services/event-bus.service');
    await publishEvent({
      organizationId,
      eventType: 'insight.created',
      source: 'AI_COPILOT',
      payload: { insightId: created.id, agentKey, type: created.type, title: created.title },
      entityType: 'INSIGHT',
      entityId: created.id,
    });

    return created;
  }

  async list(
    organizationId: string,
    filters: { page: number; pageSize: number; status?: InsightStatus; agentId?: string },
  ): Promise<PaginatedResult<InsightData>> {
    await requireRole(organizationId, ROLES.MEMBER);
    return listInsights({ organizationId, ...filters });
  }

  async acknowledge(id: string, organizationId: string): Promise<void> {
    await requireRole(organizationId, ROLES.MEMBER);
    const updated = await updateInsightStatus(id, organizationId, 'ACKNOWLEDGED');
    if (!updated) throw new NotFoundError('Insight not found.');
  }

  async dismiss(id: string, organizationId: string): Promise<void> {
    await requireRole(organizationId, ROLES.MEMBER);
    const updated = await updateInsightStatus(id, organizationId, 'DISMISSED');
    if (!updated) throw new NotFoundError('Insight not found.');
  }
}
