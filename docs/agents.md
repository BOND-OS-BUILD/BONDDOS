# Multi-Agent Architecture (Phase 7)

## Scope

Phase 6 gave Mr. Bond a generic, approval-gated way to *propose* writes (docs/tool-execution.md).
Phase 7 does not touch that write path at all — it multiplies the *reasoning* side of the system.
Mr. Bond is promoted from a single assistant into a Chief Coordinator sitting over five domain
specialists, all of which share one SDK, one registry pattern, and — critically — one write
boundary. `packages/database/prisma/schema.prisma`'s Phase 7 section states the whole design in its
own header comment:

```prisma
// ── Phase 7: Multi-Agent Architecture (AI Workforce) ────────────────────────
// Mr. Bond becomes a Coordinator over 5 specialist agents. Every write still
// flows through the unmodified Phase 6 chain (Agent -> Execution Plan ->
// Approval -> Execution -> Audit) — no agent ever calls a Tool's execute()
// directly; that remains ExecutionService's sole responsibility. Agent
// behavior (the 9 SDK methods) lives in code (apps/web/features/agents/),
// never in the DB — the `Agent` model below is a queryable metadata
// snapshot, same "code owns behavior, DB stores metadata" split as `Tool`.
// See docs/agents.md, docs/base-agent.md, docs/agent-registry.md,
// docs/delegation.md, docs/goals.md, docs/insights.md, docs/multi-agent.md.
```

Concretely, this phase is six pieces, each documented on its own: a **9-method Agent SDK**
(`apps/web/features/agents/lib/agent-definition.ts`) every agent implements identically, backed by a
**shared `BaseAgent`** that implements all the shared mechanics (docs/base-agent.md); an in-memory
**agent registry** mirroring `ToolRegistryService` (docs/agent-registry.md); a **delegation
mechanism** — the `<<DELEGATE:...>>` marker, `delegate()`/`handoff()`, and cycle-safe budget
threading (docs/delegation.md); a **Goal lifecycle** — Plan/Observe/Suggest/Wait/Continue, explicitly
invoked, never a background loop (docs/goals.md); an **Insight/Observation Engine** that only ever
reads (docs/insights.md); and **6 concrete agents** — the Coordinator plus five specialists, each
proven against real `supportedTools`/`supportedKnowledge` (docs/multi-agent.md).

## Coordinator + 5 specialists

`apps/web/features/agents/definitions/` holds exactly six agent modules:

| Agent | Category | agentKey | priority |
|---|---|---|---|
| `bond-coordinator.agent.ts` | `COORDINATOR` | `bond_coordinator` | 100 |
| `project.agent.ts` | `PROJECT` | `project_agent` | 50 |
| `sales.agent.ts` | `SALES` | `sales_agent` | 50 |
| `operations.agent.ts` | `OPERATIONS` | `operations_agent` | 50 |
| `knowledge.agent.ts` | `KNOWLEDGE` | `knowledge_agent` | 50 |
| `finance.agent.ts` | `FINANCE` | `finance_agent` | 50 |

The Coordinator's own doc comment is explicit about what "promoted" means:

```ts
/**
 * Mr. Bond, promoted from Phase 5's single assistant to Chief Coordinator
 * (Phase 7 spec: "every request first reaches Mr. Bond"). Its `supportedTools`
 * is the full read-tool set — unchanged capability from Phase 5/6 — and its
 * `think()` (inherited from `BaseAgent`, unmodified) is where a `<<DELEGATE:
 * agentKey>>{"handoff":true}` marker on the very first planning turn hands
 * the entire request to a specialist, which is the whole routing mechanism;
 * no separate router/classifier exists.
 */
```

The Coordinator's `supportedTools` is `TOOL_NAMES` — the full 9-tool set from Phase 5
(`apps/web/features/bond/services/tool-calling.service.ts`) — while every specialist declares a
narrower allowlist matching its domain (docs/multi-agent.md has the exact list per agent). Nothing
else distinguishes a specialist from the Coordinator structurally: all six are the same `BaseAgent`
subclass overriding only `descriptor` (docs/base-agent.md).

## Routing: a turn-1 handoff, not a separate classifier

There is no dedicated "which agent should handle this?" model call anywhere in this phase — routing
reuses the exact same mechanism a mid-conversation consult/handoff uses. `runThinkLoop`
(`apps/web/features/agents/services/agent-pipeline.service.ts`) appends a delegate-instructions
system message alongside the existing tool/action instructions, on every planning turn, for every
agent including the Coordinator:

```ts
function buildDelegateInstructions(availableAgents: AgentDescriptor[]): string {
  if (availableAgents.length === 0) return '';
  const list = availableAgents.map((agent) => `${agent.agentKey} (${agent.description})`).join('; ');
  return [
    'If another specialist is better suited to this request, you may consult or fully hand off to them.',
    `Available agents: ${list}.`,
    'To consult one and keep answering yourself, reply with ONLY one line: <<DELEGATE:agent_key>>{"question":"...","handoff":false}',
    'To hand off the entire request (their answer becomes the final response), use the same form with "handoff":true.',
    'Only one action/tool/delegate marker per turn — never combine them.',
  ].join(' ');
}
```

A user's message always reaches the Coordinator first (`agent-chat.service.ts`'s
`runAgentChatPipeline` defaults to `registry.getLatest('bond_coordinator')` when no `agentId` is
given). If the Coordinator's very first `generate()` call for that turn comes back with
`<<DELEGATE:project_agent>>{"question":"...","handoff":true}`, `runThinkLoop` treats it exactly like
any other handoff mid-conversation: it calls `runHandoff`, which recurses into the target's own
`think()` and streams *its* events as the rest of this turn's output. There is no routing table, no
embeddings-based classifier, no separate "route this" LLM call — "routing" is just the degenerate
case of delegation where it happens to be the first thing the Coordinator does. This is the same
design instinct as Phase 6's Intent Detection (docs/planner.md): rather than adding a second LLM
round-trip before the real planning loop, the existing loop's response is widened to mean more.

Delegate/action/tool markers are mutually exclusive on a single turn — `runThinkLoop` counts how many
marker kinds are present in one response and falls through to a plain prose answer if more than one
is:

```ts
const markerKinds = [containsActionMarker(plan.content), containsDelegateMarker(plan.content), parseToolCall(plan.content) !== null].filter(Boolean).length;
if (markerKinds > 1) break; // more than one marker type present — malformed, fall through to a final prose answer
```

## The write boundary: propose, never execute

The schema comment above states it as a hard invariant, and it is checkable the same way Phase 6's
"the execution engine knows nothing about Projects" was checkable: no file under
`apps/web/features/agents/` imports `getExecutionService` or calls a tool's `execute()`. When an
agent's planning turn produces an `<<ACTION:...>>` marker, `runThinkLoop` calls the exact same
`proposeAction` function Phase 6's `rag-pipeline.service.ts` and `POST /api/execution/plan` already
share:

```ts
const proposed = await proposeAction(
  { organizationId: ctx.organizationId, userId: ctx.userId, conversationId: ctx.conversationId },
  actionRequest,
);
```

`proposeAction` builds an `ExecutionPlan`, requests an `ApprovalRequest`, and returns — the turn ends
there, yielding an `action_proposed` event, with no further LLM call for that turn. From that point
on, the plan sits `AWAITING_APPROVAL` exactly like any Phase 5/6-originated plan, and only
`POST /api/execution/[id]/approve` (docs/approvals.md) can ever move it toward `ExecutionService`.
Nothing about being agent-proposed shortens, bypasses, or auto-approves that chain — an agent's
proposal is indistinguishable, once persisted, from one Mr. Bond proposed in Phase 6. This holds with
**no exceptions**: not for the Coordinator, not for a specialist, not for a Goal's `SUGGEST` phase
(docs/goals.md, which explicitly produces only a suggestion string, never an action marker's
side-effects), and not for the Insight Engine (docs/insights.md, which "never modifies domain data").

## `AgentContext` and structured agent-to-agent messages

Every SDK method that needs organization/session state takes an `AgentContext`
(`agent-definition.ts`):

```ts
export interface AgentContext {
  organizationId: string;
  userId: string;
  conversationId?: string;
  organization: { id: string; name: string };
  /** This agent's own allowlist — never the full 9-tool set unless the agent declares it (Coordinator does). */
  availableTools: readonly ToolName[];
  role: Role;
  availableAgents: AgentDescriptor[];
}
```

`buildAgentContext` (`apps/web/features/agents/lib/context.ts`) is the one place this gets assembled,
once per turn, by a top-level caller (docs/base-agent.md covers why that has to be a top-level caller
rather than something `BaseAgent` builds itself).

Agent-to-agent communication is deliberately not free-form prose passed around in application state.
`agent-message.ts`'s own comment states the constraint the spec imposes:

```ts
/**
 * Structured agent-to-agent communication (Phase 7 spec: "Agents never
 * exchange free-form prompts"). `AgentMessage` is a discriminated union
 * describing every shape one agent (or the pipeline) can hand another —
 * never persisted as-is; the `AgentTimelineEvent` it produces is what's
 * stored (see `agent-timeline.service.ts`), and only ever as a structured,
 * allowlisted DTO — never this message's raw text.
 */
export type AgentMessage =
  | { type: 'Request'; fromAgentKey: string | null; content: string }
  | { type: 'Response'; fromAgentKey: string; content: string; citations?: BondCitation[] }
  | { type: 'Delegation'; fromAgentKey: string; toAgentKey: string; question: string; handoff: boolean }
  | { type: 'Observation'; fromAgentKey: string; summary: string; relatedEntityIds: string[] }
  | { type: 'Summary'; fromAgentKey: string; content: string; sourceAgentKeys: string[] }
  | { type: 'Plan'; fromAgentKey: string; goalTitle: string; steps: string[] }
  | { type: 'Error'; fromAgentKey: string | null; message: string }
  | { type: 'ApprovalRequest'; fromAgentKey: string; planId: string; summary: string };
```

What actually gets persisted when one agent delegates to another is `AgentTimelineEvent`, built from
an explicit, allowlisted metadata object per event type (`AgentTimelineService`, docs/delegation.md,
docs/insights.md) — never a dump of the delegation question/answer text itself.

## Two entry points, one unchanged

Phase 5's `POST /api/bond/chat` still calls `runBondChatPipeline` directly and is completely
unmodified by this phase. Phase 7 adds a new, parallel entry point, `POST /api/agents/chat`
(`apps/web/app/api/agents/chat/route.ts` -> `runAgentChatPipeline`,
`apps/web/features/agents/services/agent-chat.service.ts`), structurally identical to Mr. Bond's own
conversation bootstrapping (get-or-create conversation, persist the `USER` message, load recent
history) but dispatching to whichever `AgentDefinition.think()` is selected — an explicit `agentKey`,
or the Coordinator by default:

```ts
const registry = getAgentRegistryService();
const agent = input.agentKey ? registry.get(input.agentKey) : registry.getLatest('bond_coordinator');
```

`agent-pipeline.service.ts`'s own comment is direct about the relationship between the two pipelines:
`runThinkLoop` is "generalized from (and, in the next build step, reused BY)
`rag-pipeline.service.ts`" — as of this phase, neither pipeline wraps the other; both call the same
retrieval/prompt/tool primitives independently, so Mr. Bond's proven, externally-consumed Phase 5
event contract never becomes structurally dependent on this newer, higher-surface-area code.

## Documentation index

- **docs/base-agent.md** — the Agent SDK's 9 methods, what `BaseAgent` provides vs. what a concrete
  agent overrides, and the module-boundary/circular-import note that keeps `base-agent.ts` and
  `agent-pipeline.service.ts` from ever importing the registry.
- **docs/agent-registry.md** — the `Agent`/`AgentRegistryService` pattern, mirroring
  `ToolRegistryService` exactly.
- **docs/delegation.md** — the `<<DELEGATE:...>>` marker, `delegate()` vs. `handoff()`, cycle
  detection, and the Sequential/Consensus/Parallel collaboration patterns.
- **docs/goals.md** — the Plan/Observe/Suggest/Wait/Continue cycle and why it is explicitly invoked
  only.
- **docs/insights.md** — the Insight Engine and Observation Engine, and why status
  acknowledge/dismiss doesn't need the Phase 6 approval chain.
- **docs/multi-agent.md** — the 6 agents' real `supportedTools`/`supportedKnowledge`, the
  collaboration-pattern topology, and the explicit "Do NOT Build" list for this phase.
- **[docs/tool-execution.md](./tool-execution.md)** / **[docs/approvals.md](./approvals.md)** — the
  unmodified Phase 6 write chain every agent-proposed action still flows through.
