'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';

import { getNodeStyle } from '../lib/node-style';

export interface GraphNodeData {
  label: string;
  nodeType: string;
  [key: string]: unknown;
}

/** Custom React Flow node: icon + title, colored by node type (see `NODE_STYLES`). */
export function GraphNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as GraphNodeData;
  const style = getNodeStyle(nodeData.nodeType);
  const Icon = style.icon;

  return (
    <div
      className="flex max-w-[180px] items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs shadow-sm"
      style={{ borderColor: style.color, borderWidth: selected ? 2 : 1 }}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
        style={{ backgroundColor: `${style.color}26` }}
      >
        <Icon className="h-3 w-3" style={{ color: style.color }} />
      </span>
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{nodeData.label}</p>
        <p className="truncate text-[10px] text-muted-foreground">{style.label}</p>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-border" />
    </div>
  );
}

export const GRAPH_NODE_TYPES = { graphNode: GraphNodeComponent };
