'use client';

import '@xyflow/react/dist/style.css';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react';

import type { TriggerType, WorkflowDefinitionStatus } from '@bond-os/database';
import { TRIGGER_TYPES } from '@bond-os/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  Label,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from '@bond-os/ui';
import { Lock, Maximize2, Save, UploadCloud } from 'lucide-react';

import { computeLayers } from '@/features/planner/lib/dag';

import type { WorkflowStepDefinition } from '../lib/workflow-graph';
import { getWorkflowNodeStyle, WORKFLOW_NODE_TYPES, type WorkflowNodeData } from './workflow-graph-node';

/**
 * The Visual Workflow Builder canvas (Phase 8) — mirrors
 * `delegation-graph.tsx`'s `ReactFlowProvider` + `useNodesState`/
 * `useEdgesState` pattern. "Use React Flow. No custom canvas."
 *
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

const TRIGGER_NODE_ID = '__trigger__';
const COLUMN_SPACING = 240;
const ROW_SPACING = 110;

export interface WorkflowBuilderCanvasProps {
  workflowId: string;
  status: WorkflowDefinitionStatus;
  triggerType: TriggerType;
  trigger: unknown;
  steps: WorkflowStepDefinition[];
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

function layerPosition(column: number, row: number): { x: number; y: number } {
  return { x: column * COLUMN_SPACING, y: row * ROW_SPACING };
}

/** Builds the initial node/edge layout once from the definition's graph — never recomputed afterward, since edits in this pass only touch node `params`/trigger config, not the graph's shape. */
function buildFlow(steps: WorkflowStepDefinition[], triggerType: TriggerType): { nodes: Node[]; edges: Edge[] } {
  const triggerNode: Node = {
    id: TRIGGER_NODE_ID,
    type: 'workflowNode',
    position: layerPosition(0, 0),
    data: { label: `Trigger: ${triggerType}`, stepType: 'TRIGGER', isTrigger: true } satisfies WorkflowNodeData,
  };

  let layers: string[][];
  try {
    layers = steps.length > 0 ? computeLayers(steps).layers : [];
  } catch {
    // A malformed graph (cycle/unknown dependency) shouldn't be possible for
    // a definition that passed `WorkflowDefinitionService.validateGraph`,
    // but fall back to one step per layer, in array order, so the canvas
    // still renders something instead of crashing the whole page.
    layers = steps.map((step) => [step.key]);
  }

  const dependedOn = new Set(steps.flatMap((step) => step.dependsOn));
  const byKey = new Map(steps.map((step) => [step.key, step]));

  const stepNodes: Node[] = layers.flatMap((layer, layerIndex) =>
    layer.map((key, row): Node => {
      const step = byKey.get(key);
      return {
        id: key,
        type: 'workflowNode',
        position: layerPosition(layerIndex + 1, row),
        data: {
          label: key,
          stepType: step?.stepType ?? 'READ_DATA',
          isTerminal: !dependedOn.has(key),
        } satisfies WorkflowNodeData,
      };
    }),
  );

  const edges: Edge[] = [];
  for (const step of steps) {
    const deps = step.dependsOn.length > 0 ? step.dependsOn : [TRIGGER_NODE_ID];
    for (const dep of deps) {
      edges.push({
        id: `${dep}->${step.key}`,
        source: dep,
        target: step.key,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { strokeWidth: 1.5 },
      });
    }
  }

  return { nodes: [triggerNode, ...stepNodes], edges };
}

export function WorkflowBuilderCanvas(props: WorkflowBuilderCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderCanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowBuilderCanvasInner({
  workflowId,
  status,
  triggerType: initialTriggerType,
  trigger: initialTrigger,
  steps: initialSteps,
}: WorkflowBuilderCanvasProps) {
  const router = useRouter();
  const { fitView } = useReactFlow();
  const isDraft = status === 'DRAFT';

  const [initialFlow] = React.useState(() => buildFlow(initialSteps, initialTriggerType));
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(initialFlow.nodes);
  const [edges, , onEdgesChange] = useEdgesState<Edge>(initialFlow.edges);

  const [steps, setSteps] = React.useState<WorkflowStepDefinition[]>(initialSteps);
  const [triggerType, setTriggerType] = React.useState<TriggerType>(initialTriggerType);
  const [trigger, setTrigger] = React.useState<unknown>(initialTrigger);
  const [dirty, setDirty] = React.useState(false);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [draftText, setDraftText] = React.useState('');
  const [draftTriggerType, setDraftTriggerType] = React.useState<TriggerType>(initialTriggerType);
  const [jsonError, setJsonError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isPublishing, setIsPublishing] = React.useState(false);

  const isTriggerSelected = selectedId === TRIGGER_NODE_ID;
  const selectedStep = selectedId && !isTriggerSelected ? (steps.find((step) => step.key === selectedId) ?? null) : null;

  function openNode(id: string) {
    setJsonError(null);
    setSelectedId(id);
    if (id === TRIGGER_NODE_ID) {
      setDraftTriggerType(triggerType);
      setDraftText(JSON.stringify(trigger ?? {}, null, 2));
    } else {
      const step = steps.find((item) => item.key === id);
      setDraftText(JSON.stringify(step?.params ?? {}, null, 2));
    }
  }

  function closePanel() {
    setSelectedId(null);
    setJsonError(null);
  }

  function applyChanges() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(draftText);
    } catch {
      setJsonError('Not valid JSON.');
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setJsonError('Must be a JSON object.');
      return;
    }
    const parsedRecord = parsed as Record<string, unknown>;

    if (isTriggerSelected) {
      setTrigger(parsedRecord);
      setTriggerType(draftTriggerType);
    } else if (selectedId) {
      const targetId = selectedId;
      setSteps((current) => current.map((step) => (step.key === targetId ? { ...step, params: parsedRecord } : step)));
      setNodes((current) =>
        current.map((node) => (node.id === targetId ? { ...node, data: { ...node.data, edited: true } } : node)),
      );
    }
    setDirty(true);
    closePanel();
    toast.success('Change applied — click "Save Draft" to persist it.');
  }

  async function handleSaveDraft() {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/workflows/${workflowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ graph: { steps }, trigger, triggerType }),
      });
      const result = (await response.json()) as ApiEnvelope<unknown>;
      if (!result.success) {
        toast.error(result.error?.message ?? 'Failed to save the draft.');
        return;
      }
      toast.success('Draft saved.');
      setDirty(false);
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePublish() {
    setIsPublishing(true);
    try {
      const response = await fetch(`/api/workflows/${workflowId}/publish`, {
        method: 'POST',
        credentials: 'include',
      });
      const result = (await response.json()) as ApiEnvelope<unknown>;
      if (!result.success) {
        toast.error(result.error?.message ?? 'Failed to publish this workflow.');
        return;
      }
      toast.success('Workflow published.');
      router.refresh();
    } finally {
      setIsPublishing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {steps.length} step{steps.length === 1 ? '' : 's'} — click a node to view {isDraft ? 'and edit ' : ''}its
          configuration.
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => fitView({ duration: 300 })}>
            <Maximize2 className="mr-2 h-4 w-4" />
            Fit view
          </Button>
          {isDraft ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={handleSaveDraft} disabled={isSaving || !dirty}>
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? 'Saving…' : 'Save Draft'}
              </Button>
              <ConfirmDialog
                trigger={
                  <Button type="button" size="sm" disabled={isPublishing}>
                    <UploadCloud className="mr-2 h-4 w-4" />
                    Publish
                  </Button>
                }
                title="Publish this workflow?"
                description={
                  dirty
                    ? 'You have unsaved local changes — save the draft first, or they will not be included in the published version. Publishing freezes the saved graph into an immutable, versioned ACTIVE definition; it can no longer be edited afterward.'
                    : "Publishing freezes this graph into an immutable, versioned ACTIVE definition. It can no longer be edited afterward — you'd create a new version instead."
                }
                confirmLabel="Publish"
                onConfirm={handlePublish}
              />
            </>
          ) : (
            <Badge variant="outline">
              <Lock className="mr-1 h-3 w-3" />
              Read-only
            </Badge>
          )}
        </div>
      </div>

      <div className="h-[560px] w-full overflow-hidden rounded-lg border border-border">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange as (changes: NodeChange[]) => void}
          onEdgesChange={onEdgesChange as (changes: EdgeChange[]) => void}
          nodeTypes={WORKFLOW_NODE_TYPES}
          onNodeClick={(_event, node) => openNode(node.id)}
          fitView
          minZoom={0.2}
          maxZoom={2}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-card" />
        </ReactFlow>
      </div>

      <Modal open={selectedId !== null} onOpenChange={(open) => !open && closePanel()}>
        <ModalContent className="sm:max-w-lg">
          <ModalHeader>
            <ModalTitle>{isTriggerSelected ? 'Trigger' : (selectedStep?.key ?? 'Step')}</ModalTitle>
            <ModalDescription>
              {isTriggerSelected
                ? 'What starts this workflow.'
                : `Step type: ${getWorkflowNodeStyle(selectedStep?.stepType ?? '').label}. Editing here only changes this step's params — its type and dependencies aren't editable in this view.`}
            </ModalDescription>
          </ModalHeader>

          <div className="space-y-4">
            {!isTriggerSelected && selectedStep ? (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">{selectedStep.stepType}</Badge>
                <span>{selectedStep.dependsOn.length > 0 ? `depends on: ${selectedStep.dependsOn.join(', ')}` : 'runs on trigger'}</span>
              </div>
            ) : null}

            {isTriggerSelected ? (
              <div className="space-y-2">
                <Label htmlFor="workflow-trigger-type">Trigger type</Label>
                <Select
                  value={draftTriggerType}
                  onValueChange={(value) => setDraftTriggerType(value as TriggerType)}
                  disabled={!isDraft}
                >
                  <SelectTrigger id="workflow-trigger-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="workflow-node-json">{isTriggerSelected ? 'Trigger config (JSON)' : 'Params (JSON)'}</Label>
              <Textarea
                id="workflow-node-json"
                value={draftText}
                onChange={(event) => {
                  setDraftText(event.target.value);
                  setJsonError(null);
                }}
                readOnly={!isDraft}
                rows={12}
                className="font-mono text-xs"
              />
              {jsonError ? <p className="text-xs text-destructive">{jsonError}</p> : null}
            </div>

            {!isTriggerSelected && selectedStep?.condition ? (
              <div className="space-y-1">
                <Label>Condition (read-only)</Label>
                <pre className="max-h-32 overflow-auto rounded-md border border-border bg-muted p-2 text-xs">
                  {JSON.stringify(selectedStep.condition, null, 2)}
                </pre>
              </div>
            ) : null}
            {!isTriggerSelected && selectedStep?.retry ? (
              <div className="space-y-1">
                <Label>Retry (read-only)</Label>
                <pre className="max-h-32 overflow-auto rounded-md border border-border bg-muted p-2 text-xs">
                  {JSON.stringify(selectedStep.retry, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={closePanel}>
              {isDraft ? 'Cancel' : 'Close'}
            </Button>
            {isDraft ? (
              <Button type="button" onClick={applyChanges}>
                Apply
              </Button>
            ) : null}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
