'use client';

import * as React from 'react';
import Link from 'next/link';

import {
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';

import type { EntitySearchResult, NeighborEdge } from '@bond-os/database';
import { Button, EmptyState, Input, Spinner } from '@bond-os/ui';
import { Maximize2, Network, Search } from 'lucide-react';

import { GraphCanvas } from './graph-canvas';
import { getNodeStyle } from '../lib/node-style';

export interface GraphSeed {
  id: string;
  type: string;
  title: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

const GRID_COLUMNS = 4;
const GRID_SPACING = 220;
const EXPAND_RADIUS = 180;

function gridPosition(index: number): { x: number; y: number } {
  return { x: (index % GRID_COLUMNS) * GRID_SPACING, y: Math.floor(index / GRID_COLUMNS) * GRID_SPACING };
}

function circlePosition(center: { x: number; y: number }, index: number, total: number): { x: number; y: number } {
  const angle = (2 * Math.PI * index) / Math.max(total, 1);
  return { x: center.x + EXPAND_RADIUS * Math.cos(angle), y: center.y + EXPAND_RADIUS * Math.sin(angle) };
}

function toFlowNode(id: string, type: string, title: string, position: { x: number; y: number }): Node {
  return { id, type: 'graphNode', position, data: { label: title, nodeType: type } };
}

function toFlowEdge(centerId: string, neighbor: NeighborEdge): Edge {
  const source = neighbor.direction === 'outgoing' ? centerId : neighbor.node.id;
  const target = neighbor.direction === 'outgoing' ? neighbor.node.id : centerId;
  return {
    id: neighbor.relationshipId,
    source,
    target,
    label: neighbor.relationshipType,
    style: { opacity: 0.4 + neighbor.confidence * 0.6 },
    labelStyle: { fontSize: 10 },
  };
}

export function GraphExplorer({ initialSeeds }: { initialSeeds: GraphSeed[] }) {
  if (initialSeeds.length === 0) {
    return (
      <EmptyState
        icon={Network}
        title="No graph data yet"
        description="Upload a document in the Library — Smart Linking will automatically extract entities and relationships."
      />
    );
  }

  return (
    <ReactFlowProvider>
      <GraphExplorerInner initialSeeds={initialSeeds} />
    </ReactFlowProvider>
  );
}

function GraphExplorerInner({ initialSeeds }: { initialSeeds: GraphSeed[] }) {
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    initialSeeds.map((seed, index) => toFlowNode(seed.id, seed.type, seed.title, gridPosition(index))),
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [query, setQuery] = React.useState('');
  const [searchResults, setSearchResults] = React.useState<EntitySearchResult[]>([]);
  const [isExpanding, setIsExpanding] = React.useState(false);

  const expandNode = React.useCallback(
    async (id: string, type: string) => {
      setIsExpanding(true);
      try {
        const response = await fetch(`/api/graph/node?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
        const json = (await response.json()) as ApiEnvelope<{ node: { id: string; type: string; title: string }; neighbors: NeighborEdge[] }>;
        if (!json.success || !json.data) return;

        const { node, neighbors } = json.data;
        setNodes((current) => {
          const center = current.find((existing) => existing.id === id)?.position ?? { x: 0, y: 0 };
          const existingIds = new Set(current.map((existing) => existing.id));
          const additions = neighbors
            .filter((neighbor) => !existingIds.has(neighbor.node.id))
            .map((neighbor, index) =>
              toFlowNode(neighbor.node.id, neighbor.node.type, neighbor.node.title, circlePosition(center, index, neighbors.length)),
            );
          const withoutCenter = current.filter((existing) => existing.id !== node.id);
          return [...withoutCenter, toFlowNode(node.id, node.type, node.title, center), ...additions];
        });

        setEdges((current) => {
          const existingIds = new Set(current.map((existing) => existing.id));
          const additions = neighbors.filter((neighbor) => !existingIds.has(neighbor.relationshipId)).map((neighbor) => toFlowEdge(id, neighbor));
          return [...current, ...additions];
        });
      } finally {
        setIsExpanding(false);
      }
    },
    [setNodes, setEdges],
  );

  React.useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSearchResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const response = await fetch(`/api/graph/search?q=${encodeURIComponent(q)}`);
      const json = (await response.json()) as ApiEnvelope<{ entities: EntitySearchResult[] }>;
      if (json.success && json.data) setSearchResults(json.data.entities);
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  function focusResult(result: EntitySearchResult) {
    setQuery('');
    setSearchResults([]);
    setNodes((current) => {
      if (current.some((existing) => existing.id === result.id)) return current;
      return [...current, toFlowNode(result.id, result.entityType, result.title, gridPosition(current.length))];
    });
    void expandNode(result.id, result.entityType);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the graph…"
            className="pl-9"
          />
          {searchResults.length > 0 ? (
            <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-md">
              {searchResults.map((result) => {
                const style = getNodeStyle(result.entityType);
                const Icon = style.icon;
                return (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => focusResult(result)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: style.color }} />
                    <span className="truncate">{result.title}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => fitView({ duration: 300 })}>
          <Maximize2 className="mr-2 h-4 w-4" />
          Fit view
        </Button>
        {isExpanding ? <Spinner size="sm" /> : null}
        <Link href="/graph/relationships" className="text-sm text-muted-foreground underline underline-offset-4">
          Relationship Explorer
        </Link>
        <Link href="/graph/timeline" className="text-sm text-muted-foreground underline underline-offset-4">
          Timeline
        </Link>
      </div>

      <GraphCanvas
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={expandNode}
      />
      <p className="text-xs text-muted-foreground">
        Click a node to expand its connections. Showing the {initialSeeds.length} most-connected/recent entities to
        start — the full graph loads lazily as you explore.
      </p>
    </div>
  );
}
