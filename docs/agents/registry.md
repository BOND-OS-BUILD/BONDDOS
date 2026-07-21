# The Agent Registry

## Scope

Two files carry the "single source of truth for which agents exist" property, and both are deliberate
mirrors of their Phase 6 `ToolRegistryService`/`tools/registry.ts` counterparts (see
[../api/tools.md](../api/tools.md)). This doc covers both files, the full descriptor of every
registered agent, why `Agent` is not organization-scoped, and the composition root
(`agents/lib/container.ts`) the rest of the feature is built from.

## Two files, one bootstrap pattern

`apps/web/features/agents/services/agent-registry.service.ts` is the generic, agent-agnostic map. Its
own doc comment says so directly (`agent-registry.service.ts:6-17`):

```ts
/**
 * The single source of truth for which agents exist (Phase 7) — mirrors
 * `ToolRegistryService` exactly. Concrete agent modules never register
 * themselves globally; `apps/web/features/agents/registry.ts` is the ONLY
 * file that imports every concrete agent and calls `register()`. Every
 * other caller (API routes, `GoalService`, `DelegationBudget.resolveAgent`)
 * only ever calls `get()`/`list()` on an instance of this class.
 */
export class AgentRegistryService {
```

`apps/web/features/agents/registry.ts` is the one place that closes the loop and actually imports
every concrete agent (`registry.ts:10-33`):

```ts
/**
 * The ONLY file in this codebase that imports every concrete agent
 * definition — mirrors `apps/web/features/tools/registry.ts` exactly.
 * `agents/lib/base-agent.ts` and `agents/services/agent-pipeline.service.ts`
 * never import this file (that would be the circular dependency documented
 * in `delegation-budget.ts`); only top-level callers (API routes,
 * `GoalService`) that already need the full agent list import it, then
 * thread `resolveAgent`/`availableAgents` down as plain data.
 */
const ALL_AGENTS: AgentDefinition[] = [bondCoordinatorAgent, projectAgent, salesAgent, operationsAgent, knowledgeAgent, financeAgent];

let instance: AgentRegistryService | undefined;

export function getAgentRegistry(): AgentRegistryService {
  if (!instance) {
    instance = new AgentRegistryService();
    for (const agent of ALL_AGENTS) {
      instance.register(agent);
    }
  }
  return instance;
}
```

Read together with `apps/web/features/tools/registry.ts`, the parallel is exact: a literal array of
every concrete implementation, registered into a lazily-constructed singleton exactly once per
process, with every other file in the codebase forbidden (by convention, and checkable by grep) from
importing a concrete agent module directly.

## `AgentRegistryService`: `get`/`getLatest`/`list`/`listOthers`/`syncToDatabase`

```ts
export class AgentRegistryService {
  private readonly agents = new Map<string, AgentDefinition>();
  private syncPromise: Promise<void> | null = null;

  register(agent: AgentDefinition): void {
    this.agents.set(this.key(agent.descriptor.agentKey, agent.descriptor.version), agent);
  }

  get(agentKey: string, version?: string): AgentDefinition | undefined {
    if (version) return this.agents.get(this.key(agentKey, version));
    return this.getLatest(agentKey);
  }

  getLatest(agentKey: string): AgentDefinition | undefined {
    const candidates = this.list().filter((agent) => agent.descriptor.agentKey === agentKey);
    if (candidates.length === 0) return undefined;
    return candidates.sort((a, b) => Number(b.descriptor.version) - Number(a.descriptor.version))[0];
  }

  list(): AgentDefinition[] {
    return Array.from(this.agents.values()).sort((a, b) => b.descriptor.priority - a.descriptor.priority);
  }

  listOthers(excludeAgentKey: string): AgentDefinition[] {
    return this.list().filter((agent) => agent.descriptor.agentKey !== excludeAgentKey);
  }
  ...
}
```
(`agent-registry.service.ts:14-40`)

- **`get(agentKey, version?)`** — version-optional, unlike `ToolRegistryService.get(toolKey, version)`
  which always requires one. Every caller in this codebase today calls it with just an `agentKey`
  (`registry.get(input.agentKey)` in `GoalService.createGoal`, `registry.get(input.fromAgentKey)` in
  `agent-delegate.service.ts`), so in practice it always falls through to `getLatest`; the optional
  second parameter exists for the same reason `ToolRegistryService.get` takes an exact version — a
  future caller pinning to a specific historical agent version, not a capability anything exercises
  yet.
- **`list()`** sorts by `priority` descending — the Coordinator's `priority: 100` against every
  specialist's `priority: 50` means `list()` always returns the Coordinator first. This is a real
  difference from `ToolRegistryService.list()`, which returns tools in insertion order with no sort
  at all; a tool has no equivalent to "the one every request should reach first."
- **`listOthers(excludeAgentKey)`** has no `ToolRegistryService` equivalent, because nothing in Phase 6
  needed "every tool except this one" — a tool never delegates to another tool. It exists specifically
  to build `AgentContext.availableAgents` ([base-agent.md](./base-agent.md)'s module-boundary section):
  the set of agents *this* agent may delegate or hand off to is every registered agent minus itself,
  computed fresh from the live registry each turn rather than hardcoded per agent.

`syncToDatabase()` mirrors `ToolRegistryService.syncToDatabase()`'s shape exactly — memoized via
`syncPromise` so concurrent callers within one process share a single upsert pass
(`agent-registry.service.ts:42-69`):

```ts
/** Idempotently upserts every registered agent's static metadata into the `Agent` table — same lazy-once-per-process ethos as `ToolRegistryService.syncToDatabase`. The DB row is a queryable metadata snapshot; behavior always lives in code. */
async syncToDatabase(): Promise<void> {
  if (!this.syncPromise) {
    this.syncPromise = Promise.all(
      this.list().map((agent) =>
        upsertAgent({
          agentKey: agent.descriptor.agentKey,
          version: agent.descriptor.version,
          name: agent.descriptor.name,
          displayName: agent.descriptor.displayName,
          description: agent.descriptor.description,
          avatar: agent.descriptor.avatar,
          category: agent.descriptor.category,
          capabilities: agent.descriptor.capabilities,
          supportedTools: [...agent.descriptor.supportedTools],
          supportedKnowledge: agent.descriptor.supportedKnowledge,
          priority: agent.descriptor.priority,
          model: agent.descriptor.model ?? null,
          temperature: agent.descriptor.temperature ?? null,
          maxContext: agent.descriptor.maxContext ?? null,
          status: 'ACTIVE',
          minimumRole: agent.descriptor.minimumRole,
        }),
      ),
    ).then(() => undefined);
  }
  await this.syncPromise;
}
```

## The six agents — full descriptors

`ALL_AGENTS` (`registry.ts:20`) lists them in this order:

```ts
const ALL_AGENTS: AgentDefinition[] = [bondCoordinatorAgent, projectAgent, salesAgent, operationsAgent, knowledgeAgent, financeAgent];
```

### Mr. Bond — Coordinator (`definitions/bond-coordinator.agent.ts:20-34`)

```ts
const descriptor: AgentDescriptor = {
  agentKey: 'bond_coordinator',
  version: '1',
  name: 'bond_coordinator',
  displayName: 'Mr. Bond',
  description: 'Chief Coordinator. Answers general questions directly and routes domain-specific requests to the Project, Sales, Operations, Knowledge, or Finance agent — consulting one for extra context or handing off the whole conversation when their expertise is the better fit.',
  avatar: 'Bot',
  category: 'COORDINATOR',
  capabilities: ['routing', 'general_qa', 'delegation', 'action_proposals'],
  supportedTools: TOOL_NAMES,
  supportedKnowledge: ['General', 'Organization Overview', 'Cross-domain Routing'],
  priority: 100,
  minimumRole: ROLES.MEMBER,
};
```

`supportedTools: TOOL_NAMES` — the Coordinator is the one agent with the full 9-tool Phase 5 set
(`search`, `graph`, `timeline`, `documents`, `projects`, `meetings`, `customers`, `emails`,
`analytics`, defined in `apps/web/features/bond/services/tool-calling.service.ts:27-38`), unchanged
capability from Phase 5/6, since it needs to be able to answer a general question or gather enough
context to decide whether to delegate at all. `priority: 100` is the highest of any agent, which is
why `list()`'s priority-descending sort always puts it first, and why `agent-chat.service.ts` defaults
to it (`registry.getLatest('bond_coordinator')`) when a request doesn't name a specific agent — see
[routing.md](./routing.md).

### Project Agent (`definitions/project.agent.ts:8-30`)

```ts
const SUPPORTED_TOOLS: readonly ToolName[] = ['projects', 'timeline', 'graph', 'search'];

const descriptor: AgentDescriptor = {
  agentKey: 'project_agent',
  version: '1',
  name: 'project_agent',
  displayName: 'Project Agent',
  description: 'Specialist in projects, tasks, roadmaps, milestones, sprint planning, and dependencies.',
  avatar: 'FolderKanban',
  category: 'PROJECT',
  capabilities: ['project_planning', 'task_tracking', 'dependency_analysis'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Projects', 'Tasks', 'Roadmaps', 'Milestones', 'Sprint Planning', 'Dependencies'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};
```

No `customers`/`emails` (Sales' domain), no `analytics`/`documents` (Operations'/Knowledge's).

### Sales Agent (`definitions/sales.agent.ts:8-30`)

```ts
const SUPPORTED_TOOLS: readonly ToolName[] = ['customers', 'emails', 'search', 'graph'];

const descriptor: AgentDescriptor = {
  agentKey: 'sales_agent',
  version: '1',
  name: 'sales_agent',
  displayName: 'Sales Agent',
  description: 'Specialist in customers, CRM, meetings, pipeline, emails, and opportunities.',
  avatar: 'Handshake',
  category: 'SALES',
  capabilities: ['crm_analysis', 'pipeline_review', 'customer_history'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Customers', 'CRM', 'Meetings', 'Pipeline', 'Emails', 'Opportunities'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};
```

Notably no `meetings` tool despite "Meetings" being a listed knowledge area — the read-tool set
(`TOOL_NAMES`) has no dedicated `meetings` tool at all in this codebase, so meeting context reaches
this agent only through `customers`/`graph`/`search` results that happen to surface it, not a
dedicated per-meeting lookup.

### Operations Agent (`definitions/operations.agent.ts:8-30`)

```ts
const SUPPORTED_TOOLS: readonly ToolName[] = ['documents', 'timeline', 'analytics', 'search'];

const descriptor: AgentDescriptor = {
  agentKey: 'operations_agent',
  version: '1',
  name: 'operations_agent',
  displayName: 'Operations Agent',
  description: 'Specialist in processes, execution tracking, documents, and day-to-day operations.',
  avatar: 'Settings',
  category: 'OPERATIONS',
  capabilities: ['process_analysis', 'document_review', 'operational_reporting'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Processes', 'Execution', 'Inventory', 'Documents', 'Operations'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};
```

### Knowledge Agent (`definitions/knowledge.agent.ts:8-30`)

```ts
const SUPPORTED_TOOLS: readonly ToolName[] = ['search', 'graph', 'timeline', 'documents', 'analytics'];

const descriptor: AgentDescriptor = {
  agentKey: 'knowledge_agent',
  version: '1',
  name: 'knowledge_agent',
  displayName: 'Knowledge Agent',
  description: 'Specialist in the knowledge graph, documents, organization memory, search, entities, and timeline.',
  avatar: 'Network',
  category: 'KNOWLEDGE',
  capabilities: ['knowledge_graph_navigation', 'document_search', 'entity_resolution'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Knowledge Graph', 'Documents', 'Memory', 'Search', 'Entities', 'Timeline'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};
```

The broadest specialist tool set (5 of the 9), reflecting that knowledge-graph/document/entity work
cuts across every other domain rather than owning a narrow slice of it the way Sales/Finance do. See
[../knowledge/graph.md](../knowledge/graph.md).

### Finance Agent (`definitions/finance.agent.ts:8-30`)

```ts
const SUPPORTED_TOOLS: readonly ToolName[] = ['analytics', 'search'];

const descriptor: AgentDescriptor = {
  agentKey: 'finance_agent',
  version: '1',
  name: 'finance_agent',
  displayName: 'Finance Agent',
  description: 'Specialist in budgets, expenses, invoices, forecasts, and reports. Does not integrate with accounting systems.',
  avatar: 'Landmark',
  category: 'FINANCE',
  capabilities: ['budget_review', 'forecast_analysis', 'reporting'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Budgets', 'Expenses', 'Invoices', 'Forecasts', 'Reports'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};
```

The narrowest tool set of any agent, and its own `description` states the exclusion directly. No
accounting-specific tool (`create_invoice`, `sync_ledger`, or similar) exists anywhere in
`apps/web/features/tools/` for this or any other agent to use.

### Side-by-side

| Agent | agentKey | category | priority | supportedTools | supportedKnowledge | minimumRole |
|---|---|---|---|---|---|---|
| Mr. Bond | `bond_coordinator` | `COORDINATOR` | 100 | all 9 (`TOOL_NAMES`) | General, Organization Overview, Cross-domain Routing | MEMBER |
| Project Agent | `project_agent` | `PROJECT` | 50 | `projects`, `timeline`, `graph`, `search` | Projects, Tasks, Roadmaps, Milestones, Sprint Planning, Dependencies | MEMBER |
| Sales Agent | `sales_agent` | `SALES` | 50 | `customers`, `emails`, `search`, `graph` | Customers, CRM, Meetings, Pipeline, Emails, Opportunities | MEMBER |
| Operations Agent | `operations_agent` | `OPERATIONS` | 50 | `documents`, `timeline`, `analytics`, `search` | Processes, Execution, Inventory, Documents, Operations | MEMBER |
| Knowledge Agent | `knowledge_agent` | `KNOWLEDGE` | 50 | `search`, `graph`, `timeline`, `documents`, `analytics` | Knowledge Graph, Documents, Memory, Search, Entities, Timeline | MEMBER |
| Finance Agent | `finance_agent` | `FINANCE` | 50 | `analytics`, `search` | Budgets, Expenses, Invoices, Forecasts, Reports | MEMBER |

Every specialist declares `minimumRole: ROLES.MEMBER` — there is no agent in this feature gated to
`ADMIN`/`OWNER` the way `archive_project` was in Phase 6. All 6 agents are reachable by any
organization member; see [../security/permissions.md](../security/permissions.md).

## `Agent`: not organization-scoped, code owns behavior

The `Agent` model's own schema comment states this as the first thing about it, in the same words
`Tool`'s comment uses (`packages/database/prisma/schema.prisma:1561-1592`):

```prisma
/// Registered-agent metadata, synced from the in-memory AgentRegistry on
/// first access each process lifetime (idempotent upsert by [agentKey,
/// version]) — mirrors `Tool` exactly, including NOT being organization-
/// scoped (a registered agent applies to every organization).
model Agent {
  id                 String              @id @default(cuid())
  agentKey           String
  version            String
  name               String
  displayName        String
  description        String
  avatar             String
  category           AgentCategory
  capabilities       Json
  supportedTools     Json
  supportedKnowledge Json
  priority           Int                 @default(0)
  model              String?
  temperature        Float?
  maxContext         Int?
  status             AgentRegistryStatus @default(ACTIVE)
  minimumRole        Role                @default(MEMBER)
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt

  goals          AgentGoal[]
  insights       Insight[]
  timelineEvents AgentTimelineEvent[]

  @@unique([agentKey, version])
  @@map("agents")
}
```

```prisma
enum AgentCategory {
  COORDINATOR
  PROJECT
  SALES
  OPERATIONS
  KNOWLEDGE
  FINANCE
}

enum AgentRegistryStatus {
  ACTIVE
  DISABLED
}
```
(`schema.prisma:1494-1506`)

There is no `organizationId` column on `Agent`, and no per-organization agent configuration anywhere
in this feature — every organization sees the same 6 agents, with the same
`supportedTools`/`supportedKnowledge`/`minimumRole`. The `@@unique([agentKey, version])` constraint is
what `upsertAgent`'s `where: { agentKey_version: { agentKey, version } }` upserts against — the same
idempotent-upsert-by-compound-key shape `Tool`'s `@@unique([toolKey, version])` uses. See
[../database/schema.md](../database/schema.md).

`packages/database/src/repositories/agents.ts`'s own doc comment states the code/DB split plainly:

```ts
/**
 * Registered-agent metadata (Phase 7). NOT organization-scoped — a
 * registered agent applies to every organization. The agent's actual
 * BEHAVIOR (the 9 SDK methods) lives in code (apps/web/features/agents/)
 * and is never read from this table; these rows exist for Agent Discovery
 * and historical/introspection display.
 */
```

`upsertAgent` (idempotent by `[agentKey, version]`), `listAgents`, `getAgentByKey`, and `getAgentById`
are the entire repository surface. Nothing in `apps/web` ever reads `capabilities`/`supportedTools`/
`supportedKnowledge`/`model`/`temperature` back off an `Agent` row to decide what an agent can do —
every one of those decisions is made against the live `AgentDefinition.descriptor` object the
in-memory registry already holds. The DB row's job is narrower: `Agent.id` is the foreign key
`AgentGoal`, `Insight`, and `AgentTimelineEvent` all point at, and it is what `GET /api/agents`/
`GET /api/agents/list` show for historical or cross-process introspection. `getAgentByKey`/
`getAgentById` show up throughout the write paths that need that foreign key —
`GoalService.createGoal`, `InsightService.record`, `AgentTimelineService`'s `resolveAgentId` — and
every one of them treats "not found" as "this agent hasn't been synced to the database yet," never as
a reason to fall back to reading behavior off the row.

## Agent Discovery: the read-only API surface

`apps/web/features/agents/services/agent-discovery.service.ts` maps the live registry to a plain,
serializable shape (`agent-discovery.service.ts:8-11`):

```ts
/**
 * Agent Discovery — maps the live in-memory registry to a plain,
 * serializable shape for `GET /api/agents` and `GET /api/agents/list`
 * (spec: both names honored). Mirrors `tool-discovery.service.ts` exactly.
 */
```

`listAgentsService`/`getAgentService` read straight off `getAgentRegistryService().list()` — never the
DB (`agent-discovery.service.ts:29-53`) — and `getAgentStatusService` (`GET /api/agents/status`) calls
every registered agent's real `health()`:

```ts
/** `GET /api/agents/status` — every registered agent's real `health()` (which itself checks the configured AI provider) — no fabricated uptime/metrics. */
export async function getAgentStatusService(organizationId: string): Promise<AgentStatus[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  const agents = getAgentRegistryService().list();
  return Promise.all(agents.map(async (agent) => ({ agentKey: agent.descriptor.agentKey, displayName: agent.descriptor.displayName, health: await agent.health() })));
}
```
(`agent-discovery.service.ts:61-73`)

See [routing.md](./routing.md) for the full `/api/agents/**` route table these services back.

## The composition root: `agents/lib/container.ts`

`apps/web/features/agents/lib/container.ts` wires up the feature's other services with the same
lazy-constructor-injection shape `execution/lib/container.ts` established in Phase 6
(`container.ts:8-16`):

```ts
/**
 * The composition root for the Agents feature (Phase 7) — mirrors
 * `execution/lib/container.ts`'s lazy-constructor-injection pattern
 * exactly. `GoalService`/`InsightService`/`AgentTimelineService` compose
 * with the existing, unmodified `execution/lib/container.ts` singletons
 * (`getPlannerService()`, `getApprovalService()`, `getToolRegistryService()`)
 * where they need Phase 6's write path — always via `proposeAction`, never
 * `getExecutionService()` directly.
 */
export function getAgentRegistryService(): AgentRegistryService {
  if (!agentRegistryService) agentRegistryService = getAgentRegistry();
  return agentRegistryService;
}
```

`getAgentRegistryService()` here is the one exception worth naming explicitly, the same way Phase 6's
`container.ts` names `getToolRegistryService()`: it is constructed inside `registry.ts`'s own
`getAgentRegistry()` — the agent-registration composition root above — and `container.ts`'s
`getAgentRegistryService()` simply wraps that same singleton rather than constructing a second one.
`GoalService`, `InsightService`, `ObservationService`, and `AgentTimelineService`
(`container.ts:18-47`) are each a plain class with no constructor dependencies, instantiated once,
lazily, the same `let`-and-null-check shape every other composition root in this codebase uses.

## What this does NOT do

- **No per-organization custom agents.** Every organization is served by the exact same 6 registered
  agents; there is no admin UI or API for an organization to register its own agent, and `Agent` has
  no `organizationId` column to scope one to.
- **No dynamic/plugin agent loading.** `ALL_AGENTS` is a literal array in `registry.ts`, populated at
  module load — no filesystem scan, no dynamic `import()`, no runtime-uploaded agent definition.
  Adding a 7th agent is a source-code change to `registry.ts`, reviewable like any other code change.
- **`AgentRegistryStatus.DISABLED` is declared but never set.** `BaseAgent.health()` always reports
  `registryStatus: 'ACTIVE'`, and no code path anywhere calls `upsertAgent` with `status: 'DISABLED'`
  — the same "prepare the interface, ship only the working half" pattern used elsewhere in this
  codebase (e.g. `TriggeredBy.SYSTEM`, see [goals.md](./goals.md)).
- **No automatic sync-on-startup.** `syncToDatabase()` exists and is idempotent, but nothing in
  `apps/web` calls it automatically on process start; it is available for whichever operational path
  needs the `Agent` table populated (an admin action, a deploy script), not wired to a Next.js
  instrumentation hook in this feature.

## Documentation index

- [overview.md](./overview.md) — where `getAgentRegistryService()` and `getAgentRegistry()` fit into
  the overall request flow.
- [base-agent.md](./base-agent.md) — why `base-agent.ts` itself never imports this registry.
- [delegation.md](./delegation.md) — `DelegationBudget.resolveAgent`, backed by this registry's
  `get()`.
- [goals.md](./goals.md) / [insights.md](./insights.md) — the two services in `container.ts` that
  resolve an `Agent` DB row by key via `getAgentByKey` before writing an `AgentGoal`/`Insight` row.
- [../api/tools.md](../api/tools.md) — the `ToolRegistryService`/`registry.ts` pattern this one
  mirrors, including the grep-checkable "only one file imports every concrete X" property.
