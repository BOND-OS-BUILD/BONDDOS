# The 6 Agents & Collaboration Patterns (Phase 7)

## Scope

This doc is the concrete proof layer for the abstractions covered elsewhere: the exact
`supportedTools`/`supportedKnowledge` each of the 6 registered agents declares
(`apps/web/features/agents/definitions/*.agent.ts`), read directly from source rather than summarized
from memory; the Sequential/Consensus/Parallel collaboration patterns applied to real specialist
scenarios; and the explicit "Do NOT Build" list this phase draws a hard line around.

## The 6 agents

All six extend `BaseAgent` and override only `descriptor` (docs/base-agent.md). `ALL_AGENTS` in
`apps/web/features/agents/registry.ts` lists them in this order:

```ts
const ALL_AGENTS: AgentDefinition[] = [bondCoordinatorAgent, projectAgent, salesAgent, operationsAgent, knowledgeAgent, financeAgent];
```

### Mr. Bond — Coordinator

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
`analytics`), unchanged capability from Phase 5/6, since it needs to be able to answer a general
question or gather enough context to decide whether to delegate at all. `priority: 100` — the highest
of any agent, which is why `AgentRegistryService.list()`'s priority-descending sort always puts it
first (docs/agent-registry.md), and why `agent-chat.service.ts` defaults to it
(`registry.getLatest('bond_coordinator')`) when a request doesn't name a specific agent.

### Project Agent

```ts
const SUPPORTED_TOOLS: readonly ToolName[] = ['projects', 'timeline', 'graph', 'search'];

const descriptor: AgentDescriptor = {
  agentKey: 'project_agent',
  ...
  category: 'PROJECT',
  capabilities: ['project_planning', 'task_tracking', 'dependency_analysis'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Projects', 'Tasks', 'Roadmaps', 'Milestones', 'Sprint Planning', 'Dependencies'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};
```

Knows: Projects, Tasks, Roadmaps, Milestones, Sprint Planning, Dependencies. Tools: `projects`,
`timeline`, `graph`, `search` — no `customers`/`emails` (Sales' domain), no `analytics`/`documents`
(Operations'/Knowledge's).

### Sales Agent

```ts
const SUPPORTED_TOOLS: readonly ToolName[] = ['customers', 'emails', 'search', 'graph'];

const descriptor: AgentDescriptor = {
  agentKey: 'sales_agent',
  ...
  category: 'SALES',
  capabilities: ['crm_analysis', 'pipeline_review', 'customer_history'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Customers', 'CRM', 'Meetings', 'Pipeline', 'Emails', 'Opportunities'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};
```

Knows: Customers, CRM, Meetings, Pipeline, Emails, Opportunities. Tools: `customers`, `emails`,
`search`, `graph` — notably no `meetings` tool despite "Meetings" being a listed knowledge area; the
read-tool set (`TOOL_NAMES`) has no dedicated `meetings` tool at all in this codebase, so meeting
context reaches this agent only through `customers`/`graph`/`search` results that happen to surface
it, not a dedicated per-meeting lookup.

### Operations Agent

```ts
const SUPPORTED_TOOLS: readonly ToolName[] = ['documents', 'timeline', 'analytics', 'search'];

const descriptor: AgentDescriptor = {
  agentKey: 'operations_agent',
  ...
  category: 'OPERATIONS',
  capabilities: ['process_analysis', 'document_review', 'operational_reporting'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Processes', 'Execution', 'Inventory', 'Documents', 'Operations'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};
```

Knows: Processes, Execution, Inventory, Documents, Operations. Tools: `documents`, `timeline`,
`analytics`, `search`.

### Knowledge Agent

```ts
const SUPPORTED_TOOLS: readonly ToolName[] = ['search', 'graph', 'timeline', 'documents', 'analytics'];

const descriptor: AgentDescriptor = {
  agentKey: 'knowledge_agent',
  ...
  category: 'KNOWLEDGE',
  capabilities: ['knowledge_graph_navigation', 'document_search', 'entity_resolution'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Knowledge Graph', 'Documents', 'Memory', 'Search', 'Entities', 'Timeline'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};
```

Knows: Knowledge Graph, Documents, Memory, Search, Entities, Timeline. Tools: `search`, `graph`,
`timeline`, `documents`, `analytics` — the broadest specialist tool set (5 of the 9), reflecting that
knowledge-graph/document/entity work cuts across every other domain rather than owning a narrow slice
of it the way Sales/Finance do.

### Finance Agent

```ts
const SUPPORTED_TOOLS: readonly ToolName[] = ['analytics', 'search'];

const descriptor: AgentDescriptor = {
  agentKey: 'finance_agent',
  ...
  category: 'FINANCE',
  capabilities: ['budget_review', 'forecast_analysis', 'reporting'],
  supportedTools: SUPPORTED_TOOLS,
  supportedKnowledge: ['Budgets', 'Expenses', 'Invoices', 'Forecasts', 'Reports'],
  priority: 50,
  minimumRole: ROLES.MEMBER,
};
```

Knows: Budgets, Expenses, Invoices, Forecasts, Reports. Tools: `analytics`, `search` — the narrowest
tool set of any agent, and its own `description` states the exclusion directly: "Does not integrate
with accounting systems." No accounting-specific tool (`create_invoice`, `sync_ledger`, or similar)
exists anywhere in `apps/web/features/tools/` for this or any other agent to use — see "Do NOT Build"
below.

### Side-by-side

| Agent | agentKey | category | priority | supportedTools | supportedKnowledge |
|---|---|---|---|---|---|
| Mr. Bond | `bond_coordinator` | `COORDINATOR` | 100 | all 9 (`TOOL_NAMES`) | General, Organization Overview, Cross-domain Routing |
| Project Agent | `project_agent` | `PROJECT` | 50 | `projects`, `timeline`, `graph`, `search` | Projects, Tasks, Roadmaps, Milestones, Sprint Planning, Dependencies |
| Sales Agent | `sales_agent` | `SALES` | 50 | `customers`, `emails`, `search`, `graph` | Customers, CRM, Meetings, Pipeline, Emails, Opportunities |
| Operations Agent | `operations_agent` | `OPERATIONS` | 50 | `documents`, `timeline`, `analytics`, `search` | Processes, Execution, Inventory, Documents, Operations |
| Knowledge Agent | `knowledge_agent` | `KNOWLEDGE` | 50 | `search`, `graph`, `timeline`, `documents`, `analytics` | Knowledge Graph, Documents, Memory, Search, Entities, Timeline |
| Finance Agent | `finance_agent` | `FINANCE` | 50 | `analytics`, `search` | Budgets, Expenses, Invoices, Forecasts, Reports |

Every specialist declares `minimumRole: ROLES.MEMBER` — there is no agent in this phase gated to
`ADMIN`/`OWNER` the way `archive_project` was in Phase 6 (docs/tool-execution.md); all 6 agents are
reachable by any organization member.

## Collaboration patterns applied to these 6 agents

docs/delegation.md covers the runtime primitives (`delegate()`, `handoff()`, `summarize()`) in full;
this section grounds the same three named patterns in scenarios these specific agents would actually
produce.

**Sequential** — a user asks the Coordinator something that touches two domains in a natural order,
e.g. "What's blocking the Acme project, and does the customer know about the delay?" The Coordinator
consults Project Agent first (`delegate()`, `handoff: false`) to learn what's blocking the project,
folds that answer into its own `messages`, then consults Sales Agent with a question informed by what
Project Agent said ("Acme's project is blocked on X — has this been communicated to the customer?").
Each `delegate()` call is awaited before the next begins; the second question's content depends on the
first answer. This is the "chained delegate calls" shape `runDelegate`'s own comment names directly.

**Consensus** — a user asks something where multiple specialists' answers need to be reconciled into
one coherent response rather than just concatenated, e.g. "Are we in good shape to close out Q3?"
touches Project (delivery status), Sales (pipeline/revenue), and Finance (budget/forecast) all at
once. The Coordinator gathers each specialist's answer — chained or fanned out, see Parallel below —
and calls `summarize()` over all three `{ agentKey, content }` pieces. `runSummarize`'s own system
prompt is built for exactly this case: "If they disagree or one flags a concern with another's
assumptions, say so explicitly rather than silently picking one" — if Sales says the pipeline looks
healthy but Finance flags the budget is over, the reconciled answer says so rather than presenting one
optimistic view.

**Parallel** — the topology distinction from Sequential/Consensus: instead of awaiting Project Agent's
answer before asking Sales Agent anything, the Coordinator issues both `delegate()` calls concurrently
(`Promise.all([projectAgent.delegate(ctx, ..., budget), salesAgent.delegate(ctx, ..., budget)])`)
against the shared `DelegationBudget`, since neither specialist's question depends on the other's
answer for the Q3 example above — Project doesn't need to know what Sales says to report delivery
status, and vice versa. Once both settle, the Coordinator fans in with one `summarize()` call over
both pieces. This is strictly a *topology* difference from Consensus, not a different mechanism: both
end at `summarize()`; Parallel just doesn't pay the latency cost of awaiting each specialist one at a
time when their answers don't actually depend on each other.

`DelegationBudget`'s cycle/depth accounting (docs/delegation.md) applies identically regardless of
which pattern the calling code assembles — `visitedAgentKeys` still prevents the Coordinator's own
Sequential chain from looping back through an agent it already consulted this turn, and the same
shared `budget` object is safe to read/mutate from concurrent Parallel calls because `enterDelegation`'s
check-then-mutate is synchronous.

## Do NOT Build

This phase draws an explicit line, matching the caution already established for Phase 5's
`send_email`-shaped gap (docs/tool-execution.md) and Phase 6's approval-only-not-signed-token
reasoning (docs/approvals.md):

- **No unapproved autonomous execution.** Every agent's only path to a domain write is
  `<<ACTION:...>>` → `proposeAction` → the unmodified Phase 6 `AWAITING_APPROVAL` → explicit human
  `POST /api/execution/[id]/approve` chain (docs/agents.md). No agent, no Goal phase, and no
  Insight/Observation call anywhere in this phase calls a tool's `execute()` or
  `getExecutionService()` directly.
- **No self-modifying agents.** `descriptor` is a `const` object defined once per agent module,
  registered once per process by `agents/registry.ts`. Nothing under `apps/web/features/agents/`
  writes back to a `descriptor` field, an `Agent` DB row's behavior-relevant columns (they're metadata
  only, docs/agent-registry.md), or a source file at runtime — an agent cannot change its own
  `supportedTools`/`supportedKnowledge`/persona based on what it learns during a conversation.
- **No recursive self-improvement.** No agent can rewrite its own prompt, its own `descriptor`, or
  another agent's definition. `summarize()`/`think()` reason over conversation content; none of the 9
  SDK methods accept or produce a change to another SDK method's implementation.
- **No agent-created agents.** `ALL_AGENTS` in `agents/registry.ts` is a literal, compile-time array of
  6 entries. There is no method on `AgentDefinition`, no API route, and no admin UI that creates a new
  `*.agent.ts` module, registers a new `AgentDescriptor` at runtime, or lets one agent instantiate
  another agent class it wasn't given by the registry.
- **No background writes without approval.** Covered by "no unapproved autonomous execution" above,
  restated for the specific shape of a background process: there is no scheduler/cron/queue-consumer
  anywhere in this codebase (docs/goals.md's grep-checkable claim) that could drive a write outside a
  request a human explicitly made and then explicitly approved.
- **No email/calendar/financial-transaction integrations.** Sales Agent's `supportedTools` includes
  `emails` — Phase 5's existing *read-only* email-listing tool (docs/tool-calling.md) — but nothing in
  this phase sends an email, creates a calendar event, or initiates a financial transaction. There is
  no `send_email`/`create_calendar_event`/`charge_card`-shaped tool registered in
  `apps/web/features/tools/registry.ts`'s `ALL_TOOLS` for any agent, Sales or otherwise, to propose.
- **No accounting integrations for Finance Agent.** Finance Agent's own `description` states this as
  policy, not just current scope: "Does not integrate with accounting systems." Its `supportedTools`
  (`analytics`, `search`) has no path to any external ledger, invoicing platform, or payment
  processor — Finance Agent can read and reason about numbers already in BOND OS, never reach outside
  it to fetch or post financial data.

## Documentation index

- **docs/agents.md** — the top-level overview: routing, the write boundary every one of these 6
  agents respects with no exceptions.
- **docs/base-agent.md** — the 9-method SDK all 6 agents implement identically via `BaseAgent`.
- **docs/agent-registry.md** — how `ALL_AGENTS` becomes the live registry these descriptors are served
  from.
- **docs/delegation.md** — the full mechanics (marker syntax, cycle detection, budget threading) behind
  the Sequential/Consensus/Parallel patterns illustrated here.
- **docs/goals.md** / **docs/insights.md** — what any of these 6 agents can do outside a single
  conversational turn, and the same explicit-invocation-only discipline applied there.
