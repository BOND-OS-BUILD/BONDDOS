'use client';

import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Bell,
  Bot,
  Clock,
  Database,
  FileText,
  GitBranch,
  Hourglass,
  Repeat,
  Search,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

/**
 * Node styling for the Workflow Builder canvas (Phase 8) — one entry per
 * real `WorkflowStepType` (see `packages/shared/src/schemas/workflows.ts`)
 * plus a synthetic `TRIGGER` entry for `WorkflowDefinition.trigger`, which
 * isn't a step at all. Mirrors `features/graph/lib/node-style.ts`'s
 * type -> {label, icon, color} shape so this canvas reads consistently with
 * the Knowledge Graph / Delegation Graph canvases.
 */
export interface WorkflowNodeStyle {
  label: string;
  icon: LucideIcon;
  color: string;
}

export const WORKFLOW_NODE_STYLES: Record<string, WorkflowNodeStyle> = {
  TRIGGER: { label: 'Trigger', icon: Zap, color: '#f59e0b' },
  READ_DATA: { label: 'Read Data', icon: Database, color: '#3b82f6' },
  SEARCH_KNOWLEDGE: { label: 'Search Knowledge', icon: Search, color: '#06b6d4' },
  INVOKE_AGENT: { label: 'Agent', icon: Bot, color: '#6366f1' },
  INVOKE_TOOL: { label: 'Tool', icon: Wrench, color: '#8b5cf6' },
  WAIT: { label: 'Wait', icon: Hourglass, color: '#64748b' },
  BRANCH: { label: 'Branch', icon: GitBranch, color: '#eab308' },
  DELAY: { label: 'Delay', icon: Clock, color: '#0ea5e9' },
  LOOP: { label: 'Loop', icon: Repeat, color: '#22c55e' },
  NOTIFICATION: { label: 'Notification', icon: Bell, color: '#ec4899' },
  GENERATE_REPORT: { label: 'Generate Report', icon: FileText, color: '#f97316' },
};

export function getWorkflowNodeStyle(stepType: string): WorkflowNodeStyle {
  return WORKFLOW_NODE_STYLES[stepType] ?? { label: stepType, icon: FileText, color: '#94a3b8' };
}

export interface WorkflowNodeData {
  label: string;
  /** A `WorkflowStepType`, or the literal `'TRIGGER'` for the synthetic trigger node. */
  stepType: string;
  isTrigger?: boolean;
  /** No step depends on this one — a terminal node in the DAG (there's no dedicated "End" step type in the backend graph). */
  isTerminal?: boolean;
  /** Locally edited via the side panel but not yet persisted with "Save Draft". */
  edited?: boolean;
  [key: string]: unknown;
}

/**
 * Custom React Flow node for one workflow step (or the synthetic Trigger
 * node) — the same icon-badge card layout as `graph-node.tsx`'s
 * `GraphNodeComponent` / `delegation-graph.tsx`'s `AgentNodeComponent`, kept
 * consistent across every React Flow canvas in this codebase.
 */
export function WorkflowGraphNodeComponent({ data, selected }: NodeProps) {
  const nodeData = data as WorkflowNodeData;
  const style = getWorkflowNodeStyle(nodeData.stepType);
  const Icon = style.icon;

  return (
    <div
      className="relative flex max-w-[200px] items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs shadow-sm"
      style={{ borderColor: style.color, borderWidth: selected ? 2 : 1 }}
    >
      {!nodeData.isTrigger ? <Handle type="target" position={Position.Left} className="!bg-border" /> : null}
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
      {nodeData.edited ? (
        <span
          className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-card bg-warning"
          title="Edited locally — not yet saved"
        />
      ) : null}
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </div>
  );
}

export const WORKFLOW_NODE_TYPES = { workflowNode: WorkflowGraphNodeComponent };
