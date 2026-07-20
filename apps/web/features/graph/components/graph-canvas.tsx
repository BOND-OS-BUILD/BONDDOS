'use client';

import '@xyflow/react/dist/style.css';

import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type EdgeChange,
  type OnNodesChange,
  type OnEdgesChange,
} from '@xyflow/react';

import { GRAPH_NODE_TYPES } from './graph-node';

export interface GraphCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node>;
  onEdgesChange: OnEdgesChange<Edge>;
  onNodeClick?: (id: string, type: string) => void;
}

/**
 * Presentational React Flow shell — zoom/pan/drag are native React Flow
 * behavior; this component owns no data, the caller (`GraphExplorer`) owns
 * nodes/edges state and expand-on-click fetching. "Use React Flow. No
 * custom canvas." — see docs/knowledge-graph.md.
 */
export function GraphCanvas({ nodes, edges, onNodesChange, onEdgesChange, onNodeClick }: GraphCanvasProps) {
  return (
    <div className="h-[600px] w-full overflow-hidden rounded-lg border border-border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange as (changes: NodeChange[]) => void}
        onEdgesChange={onEdgesChange as (changes: EdgeChange[]) => void}
        nodeTypes={GRAPH_NODE_TYPES}
        onNodeClick={(_event, node) => onNodeClick?.(node.id, (node.data as { nodeType: string }).nodeType)}
        fitView
        minZoom={0.2}
        maxZoom={2}
      >
        <Background gap={16} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-card" />
      </ReactFlow>
    </div>
  );
}
