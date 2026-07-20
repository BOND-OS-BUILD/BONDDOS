import { requireRole } from '@bond-os/auth';
import {
  appendAgentTimelineEvent,
  getAgentByKey,
  listAgentTimelineEvents,
  type AgentEventType,
  type AgentTimelineEventItem,
  type Prisma,
} from '@bond-os/database';
import { ROLES, type PaginatedResult } from '@bond-os/shared';

/**
 * Records and queries the immutable Agent Timeline (Phase 7 spec: "Store
 * structured events only. Never store chain-of-thought."). Every `record*`
 * method below builds an explicit, allowlisted metadata DTO — there is no
 * code path here that writes a raw prompt/completion string into
 * `metadata`. Also the sole source powering the Delegation Graph UI
 * (`eventType=DELEGATION`, see docs/delegation.md).
 */

export interface DelegationEventMetadata {
  toAgentKey: string;
  toAgentDisplayName: string;
  handoff: boolean;
}

export interface PlanEventMetadata {
  planId: string;
  summary: string;
  requiredRole: string;
}

export interface ExecutionEventMetadata {
  planId: string;
  status: string;
}

export interface CompletionEventMetadata {
  durationMs: number;
  toolCallsUsed: number;
}

export interface RetrievalEventMetadata {
  resultCount: number;
}

export interface ThoughtStartedEventMetadata {
  /** Truncated to 200 chars — the same content already visible in the persisted `Message`, never internal reasoning. */
  inputPreview: string;
}

export interface ApprovalRequestEventMetadata {
  planId: string;
  requiredRole: string;
}

export class AgentTimelineService {
  private readonly agentIdCache = new Map<string, string>();

  /** Resolves an `agentKey@version` to its `Agent` table id, caching hits for this process's lifetime — metadata never changes without a redeploy. Returns `undefined` (never throws) if the registry hasn't synced to the database yet, since this is best-effort observability, not a safety mechanism. */
  private async resolveAgentId(agentKey: string, version: string): Promise<string | undefined> {
    const cacheKey = `${agentKey}@${version}`;
    const cached = this.agentIdCache.get(cacheKey);
    if (cached) return cached;

    const agent = await getAgentByKey(agentKey, version);
    if (!agent) return undefined;

    this.agentIdCache.set(cacheKey, agent.id);
    return agent.id;
  }

  async recordDelegation(
    organizationId: string,
    fromAgentKey: string,
    fromAgentVersion: string,
    conversationId: string | undefined,
    metadata: DelegationEventMetadata,
  ): Promise<void> {
    await this.append(organizationId, fromAgentKey, fromAgentVersion, conversationId, 'DELEGATION', metadata);
  }

  async recordThoughtStarted(
    organizationId: string,
    agentKey: string,
    agentVersion: string,
    conversationId: string | undefined,
    input: string,
  ): Promise<void> {
    const metadata: ThoughtStartedEventMetadata = { inputPreview: input.slice(0, 200) };
    await this.append(organizationId, agentKey, agentVersion, conversationId, 'THOUGHT_STARTED', metadata);
  }

  async recordRetrieval(
    organizationId: string,
    agentKey: string,
    agentVersion: string,
    conversationId: string | undefined,
    resultCount: number,
  ): Promise<void> {
    const metadata: RetrievalEventMetadata = { resultCount };
    await this.append(organizationId, agentKey, agentVersion, conversationId, 'RETRIEVAL', metadata);
  }

  async recordPlan(
    organizationId: string,
    agentKey: string,
    agentVersion: string,
    conversationId: string | undefined,
    metadata: PlanEventMetadata,
  ): Promise<void> {
    await this.append(organizationId, agentKey, agentVersion, conversationId, 'PLAN', metadata);
  }

  async recordApprovalRequest(
    organizationId: string,
    agentKey: string,
    agentVersion: string,
    conversationId: string | undefined,
    metadata: ApprovalRequestEventMetadata,
  ): Promise<void> {
    await this.append(organizationId, agentKey, agentVersion, conversationId, 'APPROVAL_REQUEST', metadata);
  }

  async recordExecution(
    organizationId: string,
    agentKey: string,
    agentVersion: string,
    conversationId: string | undefined,
    metadata: ExecutionEventMetadata,
  ): Promise<void> {
    await this.append(organizationId, agentKey, agentVersion, conversationId, 'EXECUTION', metadata);
  }

  async recordCompletion(
    organizationId: string,
    agentKey: string,
    agentVersion: string,
    conversationId: string | undefined,
    metadata: CompletionEventMetadata,
  ): Promise<void> {
    await this.append(organizationId, agentKey, agentVersion, conversationId, 'COMPLETION', metadata);
  }

  async list(
    organizationId: string,
    filters: { conversationId?: string; agentId?: string; eventType?: AgentEventType; page: number; pageSize: number },
  ): Promise<PaginatedResult<AgentTimelineEventItem>> {
    await requireRole(organizationId, ROLES.MEMBER);
    return listAgentTimelineEvents({ organizationId, ...filters });
  }

  private async append(
    organizationId: string,
    agentKey: string,
    agentVersion: string,
    conversationId: string | undefined,
    eventType: AgentEventType,
    metadata: object,
  ): Promise<void> {
    const agentId = await this.resolveAgentId(agentKey, agentVersion);
    if (!agentId) return; // registry not yet synced to the database — skip rather than fail a user-facing turn over observability
    await appendAgentTimelineEvent({
      organizationId,
      agentId,
      conversationId,
      eventType,
      metadata: metadata as unknown as Prisma.InputJsonValue,
    });
  }
}
