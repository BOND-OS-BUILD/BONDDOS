import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { AgentEventType, Prisma } from '../generated/index.js';

/**
 * Immutable, append-only structured event log for agents (Phase 7) — mirrors
 * `AuditEvent`/`TimelineEvent`'s "never edited or deleted" convention.
 * `metadata` is always an explicit, allowlisted DTO built by
 * `AgentTimelineService`, never a raw prompt/completion capture — "store
 * structured events only, never chain-of-thought" is enforced at that
 * call site, not here. Also powers the Delegation Graph UI (query
 * `eventType=DELEGATION` for a conversation). See docs/agents.md.
 */

export interface AppendAgentTimelineEventData {
  organizationId: string;
  agentId: string;
  conversationId?: string | null;
  goalId?: string | null;
  eventType: AgentEventType;
  metadata: Prisma.InputJsonValue;
}

export async function appendAgentTimelineEvent(data: AppendAgentTimelineEventData): Promise<void> {
  await prisma.agentTimelineEvent.create({ data });
}

export interface AgentTimelineEventItem {
  id: string;
  agentId: string;
  conversationId: string | null;
  goalId: string | null;
  eventType: AgentEventType;
  metadata: unknown;
  createdAt: Date;
  /**
   * The FROM agent's `agentKey` slug (resolved via the `agent` relation).
   * Additive field — `agentId` above stays the raw database id for
   * backward compatibility. Added so the Delegation Graph UI (which only
   * has agentKey slugs from `GET /api/agents/list`, not database ids) can
   * resolve DELEGATION events' source agent without a second round trip.
   */
  agentKey: string;
}

export interface ListAgentTimelineEventsFilters {
  organizationId: string;
  conversationId?: string;
  agentId?: string;
  eventType?: AgentEventType;
  page: number;
  pageSize: number;
}

export async function listAgentTimelineEvents(
  filters: ListAgentTimelineEventsFilters,
): Promise<PaginatedResult<AgentTimelineEventItem>> {
  const { organizationId, conversationId, agentId, eventType, page, pageSize } = filters;
  const where = {
    organizationId,
    ...(conversationId && { conversationId }),
    ...(agentId && { agentId }),
    ...(eventType && { eventType }),
  };

  const [rows, total] = await Promise.all([
    prisma.agentTimelineEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { agent: { select: { agentKey: true } } },
    }),
    prisma.agentTimelineEvent.count({ where }),
  ]);

  const items: AgentTimelineEventItem[] = rows.map((row) => ({
    id: row.id,
    agentId: row.agentId,
    conversationId: row.conversationId,
    goalId: row.goalId,
    eventType: row.eventType,
    metadata: row.metadata,
    createdAt: row.createdAt,
    agentKey: row.agent.agentKey,
  }));

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
