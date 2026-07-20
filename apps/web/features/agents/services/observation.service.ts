import { requireRole } from '@bond-os/auth';
import { getOrganizationTimeline } from '@bond-os/database';
import { ROLES } from '@bond-os/shared';

import type { AgentDescriptor, AgentObservation } from '../lib/agent-definition';

/**
 * The Observation Engine (Phase 7 spec: "Agents observe... Observation
 * creates insights. Not actions."). A deterministic diff query — new/changed
 * activity since a timestamp — explicitly invoked (from an agent's own turn,
 * a Goal being advanced, or an explicit "Check for updates" action), NEVER
 * a background poll: no scheduler/cron exists anywhere in this codebase to
 * drive one, and building a poll loop with no caller would be dead code
 * that looks like it works. See docs/insights.md.
 */

const DEFAULT_LOOKBACK_DAYS = 7;
const MAX_OBSERVATIONS = 20;

/**
 * The function `BaseAgent.observe()` calls directly — no dependency on the
 * agents DI container, see `base-agent.ts`'s module-boundary note. Org-wide
 * for now (not yet filtered by the calling agent's `supportedKnowledge`
 * category — a reasonable future refinement once there's real usage data
 * showing that's worth the added complexity; today it would just be a
 * fuzzy, unreliable entity-type guess dressed up as precision).
 */
export async function observeForAgent(organizationId: string, descriptor: AgentDescriptor, since?: Date): Promise<AgentObservation[]> {
  const cutoff = since ?? new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const timeline = await getOrganizationTimeline({ organizationId, page: 1, pageSize: MAX_OBSERVATIONS });
  const recent = timeline.items.filter((event) => event.createdAt >= cutoff);

  return recent.map((event) => ({
    summary: `${event.entity.title}: ${event.description}`,
    relatedEntityIds: [event.entity.id],
  }));
}

/** The container-managed class other callers (API routes, `GoalService`) use — thin wrapper adding the org-membership check every service in this codebase performs. */
export class ObservationService {
  async observe(organizationId: string, descriptor: AgentDescriptor, since?: Date): Promise<AgentObservation[]> {
    await requireRole(organizationId, ROLES.MEMBER);
    return observeForAgent(organizationId, descriptor, since);
  }
}
