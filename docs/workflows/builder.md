# Visual Workflow Builder

## Scope

`apps/web/features/workflows/components/workflow-builder-canvas.tsx` and
`apps/web/features/workflows/components/workflow-graph-node.tsx` — the React Flow canvas an
organization uses to view and edit a `WorkflowDefinition`'s graph — plus the surrounding page
(`apps/web/app/(dashboard)/workflows/builder/[id]/page.tsx`) and list page
(`apps/web/app/(dashboard)/workflows/page.tsx`). This doc covers the canvas's actual, current scope
(a graph *view* with per-node JSON editing, not a drag-and-drop authoring tool), the React Flow node
types and their visual mapping to the 10 `WorkflowStepType`s, the trigger node, the save/publish flow,
and what creating a workflow through the UI actually looks like today.

## What library, and why

`workflow-builder-canvas.tsx`'s own comment states the technology choice directly:

```ts
/**
 * The Visual Workflow Builder canvas (Phase 8) — mirrors
 * `delegation-graph.tsx`'s `ReactFlowProvider` + `useNodesState`/
 * `useEdgesState` pattern. "Use React Flow. No custom canvas."
 */
```

The dependency is `@xyflow/react` (`^12.3.0` in `apps/web/package.json`) — the same library the
Delegation Graph (Phase 7's agent-to-agent visualization) and the Knowledge Graph canvas already use,
so a user moving between those three graph views in the app gets consistent pan/zoom/minimap
interaction without three different canvas implementations to reason about.

## Current scope, stated precisely

The canvas component's own header comment is explicit about what this pass built and what it
deliberately didn't:

```ts
/**
 * SCOPE FOR THIS PASS: a functional graph VIEW (one node per
 * `WorkflowStepDefinition` in `graph.steps`, laid out via `dag.ts`'s
 * `computeLayers`, plus a synthetic Trigger node for `definition.trigger`)
 * with basic per-node editing of raw `params` JSON via a dialog panel. There
 * is deliberately no drag-and-drop step-type palette, no adding/removing
 * nodes, and no per-type structured forms — those are a materially bigger
 * pass. There's also no synthetic "End" node: the backend graph has no such
 * step type, so a step with nothing depending on it is simply a terminal
 * node in the DAG (indicated by `isTerminal`, not a fake step).
 */
```

Concretely, what exists today:

- **A read view of an already-authored graph**, laid out automatically by reusing the same
  `computeLayers` function the run driver uses ([Workflow Engine](./workflow-engine.md)) — column =
  DAG layer, row = position within the layer. This guarantees the canvas's visual layout can never
  disagree with the driver's own execution ordering, since both are derived from the identical
  algorithm over the identical `steps` array.
- **Click-to-edit params, for `DRAFT` workflows only.** Clicking a node opens a modal with the step's
  `params` (or, for the synthetic trigger node, the trigger config) as raw, hand-edited JSON in a
  `<Textarea>`. There is no structured, per-step-type form — a `NOTIFICATION` step's `to`/`subject`/
  `body` fields are edited as JSON text, identically to an `INVOKE_TOOL` step's `__toolKey`/params.
- **No node creation, deletion, or rewiring in the canvas.** The step-type palette, drag-to-add-node,
  and edit-`dependsOn` interactions described in the platform's broader design intent do not exist in
  this component. `dependsOn` and `stepType` are shown as read-only context inside the edit modal
  (`depends on: {list}` / `runs on trigger`) but are not editable there.
- **No synthetic "End" node.** A step nothing depends on is rendered as a normal node with
  `isTerminal: true` in its `WorkflowNodeData` (used only to compute layout, not shown with special
  styling beyond what `isTerminal` might be extended to drive later) — there is no fake terminal step
  type in the backend graph to represent.
- **Read-only for a published (non-`DRAFT`) definition.** `isDraft = status === 'DRAFT'` gates every
  interactive affordance: the Save Draft / Publish buttons are replaced with a "Read-only" badge, the
  JSON textareas become `readOnly`, and the modal footer's Apply button disappears — matching
  `WorkflowDefinition`'s own immutable-once-published invariant (see [Overview](./overview.md)).

## The React Flow node types

`workflow-graph-node.tsx` defines one custom React Flow node component
(`WorkflowGraphNodeComponent`, registered as `workflowNode` in `WORKFLOW_NODE_TYPES`) shared by every
node on the canvas — the trigger node and all 10 step types render through the same component, styled
differently by a lookup table:

```ts
/**
 * Node styling for the Workflow Builder canvas — one entry per real
 * `WorkflowStepType` plus a synthetic `TRIGGER` entry for
 * `WorkflowDefinition.trigger`, which isn't a step at all. Mirrors
 * `features/graph/lib/node-style.ts`'s type -> {label, icon, color} shape
 * so this canvas reads consistently with the Knowledge Graph / Delegation
 * Graph canvases.
 */
export const WORKFLOW_NODE_STYLES: Record<string, WorkflowNodeStyle> = {
  TRIGGER:          { label: 'Trigger',          icon: Zap,       color: '#f59e0b' },
  READ_DATA:        { label: 'Read Data',        icon: Database,  color: '#3b82f6' },
  SEARCH_KNOWLEDGE: { label: 'Search Knowledge', icon: Search,    color: '#06b6d4' },
  INVOKE_AGENT:     { label: 'Agent',             icon: Bot,       color: '#6366f1' },
  INVOKE_TOOL:      { label: 'Tool',              icon: Wrench,    color: '#8b5cf6' },
  WAIT:             { label: 'Wait',              icon: Hourglass, color: '#64748b' },
  BRANCH:           { label: 'Branch',            icon: GitBranch, color: '#eab308' },
  DELAY:            { label: 'Delay',             icon: Clock,     color: '#0ea5e9' },
  LOOP:             { label: 'Loop',              icon: Repeat,    color: '#22c55e' },
  NOTIFICATION:     { label: 'Notification',      icon: Bell,      color: '#ec4899' },
  GENERATE_REPORT:  { label: 'Generate Report',   icon: FileText,  color: '#f97316' },
};
```

An unrecognized `stepType` string falls back to `{ label: stepType, icon: FileText, color: '#94a3b8' }`
(`getWorkflowNodeStyle`) rather than throwing — the canvas degrades gracefully instead of crashing the
page if a graph somehow contains a step type the frontend's own style table hasn't been updated for.

Each node renders as a small icon-badge card — an 18px circular icon swatch tinted with the step's
color at 15% opacity (`${color}26` — an 8-digit hex alpha suffix), the step's `key` as its primary
label and the step type's human-readable `label` beneath it, a target `Handle` on the left (omitted for
the trigger node, which has no incoming edge) and a source `Handle` on the right, and a small amber dot
in the corner if the node has unsaved local edits (`edited: true`) — the same icon-badge card layout
`graph-node.tsx`'s `GraphNodeComponent` (Knowledge Graph) and `delegation-graph.tsx`'s
`AgentNodeComponent` (Phase 7's Delegation Graph) use, kept visually consistent across every React Flow
canvas in this codebase.

### The synthetic Trigger node

`WorkflowDefinition.trigger` isn't a step in the graph at all — `buildFlow` (the canvas's layout
function) synthesizes one extra node, `id: '__trigger__'`, positioned at column 0 ahead of every real
step layer, labeled `Trigger: {triggerType}`. Every step with an empty `dependsOn` array gets an edge
drawn from this synthetic node instead of floating disconnected — `deps = step.dependsOn.length > 0 ?
step.dependsOn : [TRIGGER_NODE_ID]` — so the canvas always shows one connected graph rooted at the
trigger, never a set of disjoint components. Clicking the trigger node opens the same edit modal, but
with a `<Select>` for `triggerType` (one of the 10 `TRIGGER_TYPES`) instead of the step-type badge, and
the trigger's `config` object as the JSON text area.

## Editing and saving a draft

The interaction is deliberately staged in two steps, matching the modal's own toast copy
("click 'Save Draft' to persist it"):

1. **Apply** (in the per-node modal) only updates the canvas's local React state — the edited node
   gains its `edited: true` badge, and the workflow-level `dirty` flag is set. Nothing is sent to the
   server yet.
2. **Save Draft** sends the *entire* current `{ graph: { steps }, trigger, triggerType }` as one
   `PATCH /api/workflows/{workflowId}` request — every local edit accumulated since the page loaded (or
   since the last save) goes out together, not one request per node. A successful save clears `dirty`
   and calls `router.refresh()`, which re-fetches the definition server-side and re-renders the page
   (including a fresh canvas built from the now-persisted graph).

**Publish** is a separate, irreversible action, guarded by a confirmation dialog whose copy changes
depending on whether there are unsaved local edits:

- With unsaved changes: *"You have unsaved local changes — save the draft first, or they will not be
  included in the published version. Publishing freezes the saved graph into an immutable, versioned
  `ACTIVE` definition; it can no longer be edited afterward."*
- Without unsaved changes: *"Publishing freezes this graph into an immutable, versioned `ACTIVE`
  definition. It can no longer be edited afterward — you'd create a new version instead."*

`POST /api/workflows/{workflowId}/publish` is what performs the transition — see
[Workflow Engine](./workflow-engine.md) and [Overview](./overview.md) for what "immutable, versioned"
means at the data-model level, and the `ownerId`-required-for-write-steps check that can reject a
publish attempt outright.

## Creating a new workflow: templates are the only UI path today

`workflows/page.tsx` (the `/workflows` list page) has no "blank canvas" creation flow. Its empty-state
and header "New Workflow" / "Browse Templates" actions both link to an in-page anchor
(`#templates`) that scrolls to the embedded `WorkflowTemplatesSection` — the *only* way to create a
`WorkflowDefinition` from the UI is to instantiate one of the 5 built-in templates (see
[Templates](./templates.md)), which lands as an editable `DRAFT` and redirects straight into
`/workflows/builder/{id}`.

`POST /api/workflows` (creating a definition directly from a hand-authored `{ trigger, graph, ... }`
JSON body) exists and is fully functional at the API layer — `WorkflowDefinitionService.create`
enforces the same `requireRole`/`validateGraph` checks either path goes through — but there is no form
or dialog anywhere in the app that calls it directly; reaching it means calling the API yourself
(or, in effect, starting from a template and editing every field in the builder's params-JSON editor
until it no longer resembles the original).

## Documentation index

- **[Overview](./overview.md)** — the UI surface table (all five `/workflows/*` pages) and API surface
  this canvas is one piece of.
- **[Workflow Engine](./workflow-engine.md)** — the `WorkflowGraphDefinition`/`WorkflowStepDefinition`
  JSON shape this canvas renders and edits, and the `computeLayers` layout algorithm it reuses.
- **[Templates](./templates.md)** — the 5 built-in templates, and why instantiating one is the only
  creation path exposed in the UI.
- **[Approvals](./approvals.md)** — what happens once a published workflow's `INVOKE_TOOL`/
  `INVOKE_AGENT` step actually runs (nothing about approval is visible in the builder itself — it's a
  runtime concern of the run, not the graph's authoring).
