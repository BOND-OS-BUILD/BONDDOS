'use client';

import '@xyflow/react/dist/style.css';

import * as React from 'react';

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';

import type { AgentTimelineEventItem } from '@bond-os/database';
import { Button, EmptyState, Spinner } from '@bond-os/ui';
import * as LucideIcons from 'lucide-react';
import { Maximize2, type LucideIcon } from 'lucide-react';

import type { AvailableAgent } from '../services/agent-discovery.service';
import type { DelegationEventMetadata } from '../services/agent-timeline.service';

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

interface PaginatedEnvelope<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const GRID_COLUMNS = 4;
const GRID_SPACING = 200;
const AGENT_COLOR = '#6366f1';
const HANDOFF_COLOR = '#6366f1';
const CONSULT_COLOR = '#94a3b8';

function gridPosition(index: number): { x: number; y: number } {
  return { x: (index % GRID_COLUMNS) * GRID_SPACING, y: Math.floor(index / GRID_COLUMNS) * GRID_SPACING };
}

/** Resolves a `descriptor.avatar` string (e.g. "Landmark") to its lucide-react icon, falling back to a generic bot icon for unknown/missing names — keeps unrecognized agents rendering as a plain labeled box instead of erroring. */
function resolveAgentIcon(avatar: string | undefined): LucideIcon {
  if (!avatar) return LucideIcons.Bot;
  const icons = LucideIcons as unknown as Record<string, LucideIcon>;
  return icons[avatar] ?? LucideIcons.Bot;
}

interface AgentNodeData {
  label: string;
  avatar?: string;
  [key: string]: unknown;
}

/** Custom React Flow node for one agent — mirrors `features/graph/components/graph-node.tsx`'s icon-badge layout. */
function AgentNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as AgentNodeData;
  const Icon = resolveAgentIcon(nodeData.avatar);

  return (
    <div
      className="flex max-w-[180px] items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs shadow-sm"
      style={{ borderColor: AGENT_COLOR, borderWidth: selected ? 2 : 1 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${AGENT_COLOR}26` }}
      >
        <Icon className="h-3 w-3" style={{ color: AGENT_COLOR }} />
      </span>
      <p className="truncate font-medium text-foreground">{nodeData.label}</p>
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}

const AGENT_NODE_TYPES = { agentNode: AgentNodeComponent };

function toAgentNode(agentKey: string, label: string, avatar: string | undefined, index: number): Node {
  return { id: agentKey, type: 'agentNode', position: gridPosition(index), data: { label, avatar } };
}

function toDelegationEdge(event: AgentTimelineEventItem): Edge | null {
  const metadata = event.metadata as Partial<DelegationEventMetadata> | null;
  if (!metadata?.toAgentKey) return null;

  const handoff = Boolean(metadata.handoff);
  const color = handoff ? HANDOFF_COLOR : CONSULT_COLOR;

  return {
    id: event.id,
    source: event.agentKey,
    target: metadata.toAgentKey,
    label: handoff ? 'handoff' : 'consult',
    animated: handoff,
    style: handoff ? { stroke: color, strokeWidth: 2 } : { stroke: color, strokeWidth: 1.5, strokeDasharray: '5 5' },
    labelStyle: { fontSize: 10 },
    markerEnd: { type: MarkerType.ArrowClosed, color },
  };
}

/**
 * Delegation Graph (Phase 7 "Multi-Agent Architecture") — visualizes which
 * agents have delegated/handed off to which others, sourced from
 * `AgentTimelineEvent` rows where `eventType='DELEGATION'`. "Use React Flow.
 * No custom canvas." Fetches client-side on mount (no server-provided
 * seeds, unlike the Knowledge Graph explorer, since the whole delegation
 * history for the org is small enough to load in one page).
 */
export function DelegationGraph() {
  return (
    <ReactFlowProvider>
      <DelegationGraphInner />
    </ReactFlowProvider>
  );
}

function DelegationGraphInner() {
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [eventCount, setEventCount] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const [agentsResponse, timelineResponse] = await Promise.all([
          fetch('/api/agents/list'),
          fetch('/api/agents/timeline?eventType=DELEGATION&page=1&pageSize=100'),
        ]);

        const agentsJson = (await agentsResponse.json()) as ApiEnvelope<AvailableAgent[]>;
        const timelineJson = (await timelineResponse.json()) as ApiEnvelope<PaginatedEnvelope<AgentTimelineEventItem>>;

        if (!timelineJson.success || !timelineJson.data) {
          throw new Error(timelineJson.error?.message ?? 'Failed to load the delegation timeline.');
        }

        const agentsByKey = new Map<string, AvailableAgent>();
        if (agentsJson.success && agentsJson.data) {
          for (const agent of agentsJson.data) agentsByKey.set(agent.agentKey, agent);
        }

        const events = timelineJson.data.items.filter(
          (item): item is AgentTimelineEventItem & { metadata: DelegationEventMetadata } =>
            item.eventType === 'DELEGATION' &&
            typeof (item.metadata as Partial<DelegationEventMetadata> | null)?.toAgentKey === 'string',
        );

        // One node per distinct agent (either side of a delegation), labeled from the
        // live registry when known, falling back to the delegation event's own
        // `toAgentDisplayName` (covers a "to" agent that isn't in the discovery list)
        // and finally the raw agentKey.
        const displayNameByKey = new Map<string, string>();
        for (const event of events) {
          displayNameByKey.set(event.metadata.toAgentKey, event.metadata.toAgentDisplayName);
        }

        const agentKeys = new Set<string>();
        for (const event of events) {
          agentKeys.add(event.agentKey);
          agentKeys.add(event.metadata.toAgentKey);
        }

        const nextNodes = Array.from(agentKeys).map((agentKey, index) => {
          const registered = agentsByKey.get(agentKey);
          const label = registered?.displayName ?? displayNameByKey.get(agentKey) ?? agentKey;
          return toAgentNode(agentKey, label, registered?.avatar, index);
        });

        const nextEdges = events
          .map((event) => toDelegationEdge(event))
          .filter((edge): edge is Edge => edge !== null);

        if (cancelled) return;
        setNodes(nextNodes);
        setEdges(nextEdges);
        setEventCount(events.length);
        requestAnimationFrame(() => fitView({ duration: 300 }));
      } catch (error) {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : 'Failed to load the delegation graph.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [setNodes, setEdges, fitView]);

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (loadError) {
    return (
      <EmptyState
        icon={LucideIcons.AlertTriangle}
        title="Couldn't load the delegation graph"
        description={loadError}
      />
    );
  }

  if (eventCount === 0) {
    return (
      <EmptyState
        icon={LucideIcons.Workflow}
        title="No delegations yet"
        description="Delegation and consult hand-offs between agents will appear here once agents start collaborating."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <span className="mr-3 inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 align-middle" style={{ backgroundColor: HANDOFF_COLOR }} />
            handoff
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4 align-middle"
              style={{
                backgroundColor: CONSULT_COLOR,
                backgroundImage: `repeating-linear-gradient(90deg, ${CONSULT_COLOR} 0 3px, transparent 3px 6px)`,
              }}
            />
            consult
          </span>
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => fitView({ duration: 300 })}>
          <Maximize2 className="mr-2 h-4 w-4" />
          Fit view
        </Button>
      </div>

      <div className="h-[500px] w-full overflow-hidden rounded-lg border border-border">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange as (changes: NodeChange[]) => void}
          onEdgesChange={onEdgesChange as (changes: EdgeChange[]) => void}
          nodeTypes={AGENT_NODE_TYPES}
          fitView
          minZoom={0.2}
          maxZoom={2}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-card" />
        </ReactFlow>
      </div>
      <p className="text-xs text-muted-foreground">
        {eventCount} delegation event{eventCount === 1 ? '' : 's'} across {nodes.length} agent
        {nodes.length === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
