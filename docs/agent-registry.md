# The Agent Registry (Phase 7)

## Scope

Two files carry the "single source of truth for which agents exist" property, and both are
deliberate mirrors of their Phase 6 counterparts. `apps/web/features/agents/services/agent-registry.service.ts`
is the generic, agent-agnostic map — its own doc comment says so directly:

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
every concrete agent:

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

Read together with `apps/web/features/tools/registry.ts` (docs/tool-execution.md), the parallel is
exact: a literal array of every concrete implementation, registered into a lazily-constructed
singleton exactly once per process, with every other file in the codebase forbidden (by convention,
and checkable by grep) from importing a concrete agent module directly.

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

`get(agentKey, version?)` — version-optional, unlike `ToolRegistryService.get(toolKey, version)`
which always requires one. Every caller in this codebase today calls it with just an `agentKey`
(`registry.get(input.agentKey)` in `GoalService.createGoal`, `registry.get(input.fromAgentKey)` in
`agent-delegate.service.ts`), so in practice it always falls through to `getLatest`; the optional
second parameter exists for the same reason `ToolRegistryService.get` takes an exact version — a
future caller pinning to a specific historical agent version, not a capability anything exercises
yet.

`list()` sorts by `priority` descending — the Coordinator's `priority: 100` against every
specialist's `priority: 50` means `list()` always returns the Coordinator first. This is a real
difference from `ToolRegistryService.list()`, which returns tools in insertion order with no sort at
all; a tool has no equivalent to "the one every request should reach first."

`listOthers(excludeAgentKey)` has no `ToolRegistryService` equivalent, because nothing in Phase 6
needed "every tool except this one" — a tool never delegates to another tool. It exists specifically
to build `AgentContext.availableAgents` (docs/base-agent.md's module-boundary section,
`apps/web/features/agents/lib/context.ts`'s `buildAgentContext`): the set of agents *this* agent may
delegate or hand off to is every registered agent minus itself, computed fresh from the live registry
each turn rather than hardcoded per agent.

`syncToDatabase()` mirrors `ToolRegistryService.syncToDatabase()`'s shape exactly — memoized via
`syncPromise` so concurrent callers within one process share a single upsert pass:

```ts
/** Idempotently upserts every registered agent's static metadata into the `Agent` table — same lazy-once-per-process ethos as `ToolRegistryService.syncToDatabase`. The DB row is a queryable metadata snapshot; behavior always lives in code. */
async syncToDatabase(): Promise<void> {
  if (!this.syncPromise) {
    this.syncPromise = Promise.all(
      this.list().map((agent) =>
        upsertAgent({
          agentKey: agent.descriptor.agentKey,
          version: agent.descriptor.version,
          ...
          status: 'ACTIVE',
          minimumRole: agent.descriptor.minimumRole,
        }),
      ),
    ).then(() => undefined);
  }
  await this.syncPromise;
}
```

## Not organization-scoped

The `Agent` model's own schema comment states this as the first thing about it, in the same words
`Tool`'s comment uses:

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

There is no `organizationId` column on `Agent`, and no per-organization agent configuration anywhere
in this phase — every organization sees the same 6 agents, with the same `supportedTools`/
`supportedKnowledge`/`minimumRole`. The `@@unique([agentKey, version])` constraint is what
`upsertAgent`'s `where: { agentKey_version: { agentKey, version } }` upserts against — the same
idempotent-upsert-by-compound-key shape `Tool`'s `@@unique([toolKey, version])` uses.

## Code owns behavior, the DB row is a metadata snapshot

`packages/database/src/repositories/agents.ts`'s own doc comment states the split plainly:

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
`AgentGoal`, `Insight`, and `AgentTimelineEvent` all point at (so those tables can be queried/joined
without re-deriving an agent's identity from a key+version pair every time), and it is what
`GET /api/agents`/`GET /api/agents/list` would show for historical or cross-process introspection.
`getAgentByKey`/`getAgentById` show up throughout the Phase 7 write paths that need that foreign key —
`GoalService.createGoal`, `InsightService.record`, `AgentTimelineService`'s `resolveAgentId` — and
every one of them treats "not found" as "this agent hasn't been synced to the database yet," never as
a reason to fall back to reading behavior off the row.

## Idempotent upsert-by-key: same pattern, same reasoning as `Tool`

`syncToDatabase()`'s upsert is keyed on the same compound identity Phase 6 used for `Tool`
(`[toolKey, version]` there, `[agentKey, version]` here), for the same reason: a concrete agent's
static metadata (`name`, `displayName`, `description`, `capabilities`, `supportedTools`,
`supportedKnowledge`, `priority`, `model`, `temperature`, `maxContext`, `minimumRole`) can change
between deploys as the source file changes, and the DB row needs to reflect whatever the *currently
running* code declares — an `upsert`, not an `insert`-then-ignore, is what keeps the row from drifting
stale after a redeploy that only touched a `description` string. The `syncPromise` memoization is the
same "cheap enough on cold start, same lazy-once-per-process ethos as every other composition-root
singleton" reasoning `ToolRegistryService.syncToDatabase()` uses (docs/tool-execution.md).

## Agent Discovery: the read-only API surface

`apps/web/features/agents/services/agent-discovery.service.ts` maps the live registry to a plain,
serializable shape — its own comment states which Phase 6 file it mirrors:

```ts
/**
 * Agent Discovery — maps the live in-memory registry to a plain,
 * serializable shape for `GET /api/agents` and `GET /api/agents/list`
 * (spec: both names honored). Mirrors `tool-discovery.service.ts` exactly.
 */
```

`listAgentsService`/`getAgentService` read straight off `getAgentRegistryService().list()` — never
the DB — and `getAgentStatusService` (`GET /api/agents/status`) calls every registered agent's real
`health()`:

```ts
/** `GET /api/agents/status` — every registered agent's real `health()` (which itself checks the configured AI provider) — no fabricated uptime/metrics. */
export async function getAgentStatusService(organizationId: string): Promise<AgentStatus[]> {
  await requireRole(organizationId, ROLES.MEMBER);
  const agents = getAgentRegistryService().list();
  return Promise.all(agents.map(async (agent) => ({ agentKey: agent.descriptor.agentKey, displayName: agent.descriptor.displayName, health: await agent.health() })));
}
```

Consistent with Agent Discovery reading only the live registry: this is genuinely a live capability
check, not a DB read reformatted as a health status.

## The composition root: `agents/lib/container.ts`

`apps/web/features/agents/lib/container.ts` wires up the feature's other services with the same
lazy-constructor-injection shape `execution/lib/container.ts` established in Phase 6:

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
`GoalService`, `InsightService`, `ObservationService`, and `AgentTimelineService` are each a plain
class with no constructor dependencies, instantiated once, lazily, the same `let`-and-null-check shape
every other composition root in this codebase uses.

## What this does NOT do

- **No per-organization custom agents.** Every organization is served by the exact same 6 registered
  agents; there is no admin UI or API for an organization to register its own agent, and `Agent` has
  no `organizationId` column to scope one to.
- **No dynamic/plugin agent loading.** `ALL_AGENTS` is a literal array in `registry.ts`, populated at
  module load — no filesystem scan, no dynamic `import()`, no runtime-uploaded agent definition.
  Adding a 7th agent is a source-code change to `registry.ts`, reviewable like any other code change.
- **`AgentRegistryStatus.DISABLED` is declared but never set.** `BaseAgent.health()` always reports
  `registryStatus: 'ACTIVE'`, and no code path anywhere calls `upsertAgent` with
  `status: 'DISABLED'` — the same "prepare the interface, ship only the working half" pattern already
  used for `TriggeredBy.SYSTEM` (docs/goals.md) and, in earlier phases, `Queue`/`Cache`.
- **No automatic sync-on-startup.** `syncToDatabase()` exists and is idempotent, but — mirroring
  `ToolRegistryService.syncToDatabase()`'s own status in this codebase — nothing in `apps/web` calls
  it automatically on process start; it is available for whichever operational path needs the `Agent`
  table populated (an admin action, a deploy script), not wired to a Next.js instrumentation hook in
  this phase.

## Documentation index

- **[docs/tool-execution.md](./tool-execution.md)** — the `ToolRegistryService`/`registry.ts` pattern
  this one mirrors, including the grep-checkable "only one file imports every concrete X" property.
- **docs/agents.md** — where `getAgentRegistryService()` and `getAgentRegistry()` fit into the overall
  Phase 7 request flow.
- **docs/base-agent.md** — why `base-agent.ts` itself never imports this registry.
- **docs/delegation.md** — `DelegationBudget.resolveAgent`, backed by this registry's `get()`.
- **docs/goals.md** / **docs/insights.md** — the two services in `container.ts` that resolve an
  `Agent` DB row by key via `getAgentByKey` before writing a `AgentGoal`/`Insight` row.
