import { getAgentRegistry } from '../registry';
import { AgentRegistryService } from '../services/agent-registry.service';
import { AgentTimelineService } from '../services/agent-timeline.service';
import { GoalService } from '../services/goal.service';
import { InsightService } from '../services/insight.service';
import { ObservationService } from '../services/observation.service';

/**
 * The composition root for the Agents feature (Phase 7) — mirrors
 * `execution/lib/container.ts`'s lazy-constructor-injection pattern
 * exactly. `GoalService`/`InsightService`/`AgentTimelineService` compose
 * with the existing, unmodified `execution/lib/container.ts` singletons
 * (`getPlannerService()`, `getApprovalService()`, `getToolRegistryService()`)
 * where they need Phase 6's write path — always via `proposeAction`, never
 * `getExecutionService()` directly. See docs/agent-registry.md.
 */

let agentRegistryService: AgentRegistryService | undefined;
let goalService: GoalService | undefined;
let insightService: InsightService | undefined;
let observationService: ObservationService | undefined;
let agentTimelineService: AgentTimelineService | undefined;

export function getAgentRegistryService(): AgentRegistryService {
  if (!agentRegistryService) agentRegistryService = getAgentRegistry();
  return agentRegistryService;
}

export function getGoalService(): GoalService {
  if (!goalService) goalService = new GoalService();
  return goalService;
}

export function getInsightService(): InsightService {
  if (!insightService) insightService = new InsightService();
  return insightService;
}

export function getObservationService(): ObservationService {
  if (!observationService) observationService = new ObservationService();
  return observationService;
}

export function getAgentTimelineService(): AgentTimelineService {
  if (!agentTimelineService) agentTimelineService = new AgentTimelineService();
  return agentTimelineService;
}
