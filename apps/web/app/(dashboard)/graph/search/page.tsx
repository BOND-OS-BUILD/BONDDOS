'use client';

import * as React from 'react';
import Link from 'next/link';

import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Spinner } from '@bond-os/ui';
import { History, Network, Search as SearchIcon, Waypoints } from 'lucide-react';

import { getNodeStyle, nodeHref } from '@/features/graph/lib/node-style';

interface EntitySearchResult {
  id: string;
  entityType: string;
  title: string;
  description: string | null;
  knowledgeDocumentId: string | null;
  snippet: string;
  score: number;
}

interface RelationshipEdge {
  id: string;
  relationshipType: string;
  confidence: number;
  createdAt: string;
  sourceEntity: { id: string; title: string; entityType: string };
  targetEntity: { id: string; title: string; entityType: string };
}

interface TimelineEventItem {
  id: string;
  eventType: string;
  description: string;
  metadata: unknown;
  createdAt: string;
  entity: { id: string; title: string; entityType: string };
}

interface GraphSearchResults {
  entities: EntitySearchResult[];
  relationships: RelationshipEdge[];
  timeline: TimelineEventItem[];
}

/**
 * Renders a `ts_headline` snippet safely. Postgres wraps matched terms in
 * literal `<b>...</b>` (the default StartSel/StopSel) but does NOT escape
 * the surrounding text — that text is a user-entered title/description, so
 * treating the whole string as HTML (`dangerouslySetInnerHTML`) would be a
 * stored-XSS hole. Instead, split on the exact `<b>`/`</b>` delimiters we
 * asked for and render each segment as plain text (React escapes it
 * automatically), only using a real element for the highlighted spans.
 */
function renderHighlightedSnippet(snippet: string): React.ReactNode {
  const parts = snippet.split(/(<b>|<\/b>)/);
  const nodes: React.ReactNode[] = [];
  let highlighting = false;

  parts.forEach((part, index) => {
    if (part === '<b>') {
      highlighting = true;
      return;
    }
    if (part === '</b>') {
      highlighting = false;
      return;
    }
    if (!part) return;
    nodes.push(
      highlighting ? (
        <strong key={index} className="text-foreground">
          {part}
        </strong>
      ) : (
        <React.Fragment key={index}>{part}</React.Fragment>
      ),
    );
  });

  return nodes;
}

export default function GraphSearchPage() {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<GraphSearchResults | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const handle = setTimeout(async () => {
      const response = await fetch(`/api/graph/search?q=${encodeURIComponent(q)}`);
      const json = await response.json();
      if (json.success) {
        setResults(json.data as GraphSearchResults);
      }
      setIsLoading(false);
    }, 300);

    return () => clearTimeout(handle);
  }, [query]);

  const totalResults = results
    ? results.entities.length + results.relationships.length + results.timeline.length
    : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Graph Search</h1>
        <p className="text-sm text-muted-foreground">
          Search entities, relationships, and activity across the knowledge graph.
        </p>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search the knowledge graph…"
          className="pl-9"
        />
        {isLoading ? <Spinner size="sm" className="absolute right-3 top-1/2 -translate-y-1/2" /> : null}
      </div>

      {!query.trim() ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Start typing to search.</p>
      ) : !isLoading && results && totalResults === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">No results for &quot;{query}&quot;.</p>
      ) : (
        <div className="space-y-4">
          {results && results.entities.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Network className="h-4 w-4" />
                  Entities
                  <Badge variant="secondary">{results.entities.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {results.entities.map((item) => {
                  const style = getNodeStyle(item.entityType);
                  const Icon = style.icon;
                  const href = nodeHref(item.entityType, item.id);
                  const rowClassName = 'block rounded-md px-2 py-1.5 text-sm hover:bg-accent';
                  const content = (
                    <>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0" style={{ color: style.color }} />
                        <span className="font-medium">{item.title}</span>
                      </div>
                      <p className="pl-6 text-xs text-muted-foreground">
                        {renderHighlightedSnippet(item.snippet)}
                      </p>
                    </>
                  );

                  return href ? (
                    <Link key={item.id} href={href} className={rowClassName}>
                      {content}
                    </Link>
                  ) : (
                    <div key={item.id} className={rowClassName}>
                      {content}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {results && results.relationships.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Waypoints className="h-4 w-4" />
                  Relationships
                  <Badge variant="secondary">{results.relationships.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {results.relationships.map((edge) => {
                  const href = nodeHref(edge.sourceEntity.entityType, edge.sourceEntity.id);
                  const rowClassName = 'block rounded-md px-2 py-1.5 text-sm hover:bg-accent';
                  const content = (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate">{edge.sourceEntity.title}</span>
                      <Badge variant="secondary">{edge.relationshipType}</Badge>
                      <span className="truncate">{edge.targetEntity.title}</span>
                      <span className="text-xs text-muted-foreground">{Math.round(edge.confidence * 100)}%</span>
                    </div>
                  );

                  return href ? (
                    <Link key={edge.id} href={href} className={rowClassName}>
                      {content}
                    </Link>
                  ) : (
                    <div key={edge.id} className={rowClassName}>
                      {content}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          {results && results.timeline.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <History className="h-4 w-4" />
                  Timeline
                  <Badge variant="secondary">{results.timeline.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {results.timeline.map((item) => {
                  const href = nodeHref(item.entity.entityType, item.entity.id);
                  const rowClassName = 'block rounded-md px-2 py-1.5 text-sm hover:bg-accent';
                  const content = (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.entity.title}</span>
                        <Badge variant="outline">{item.eventType}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </>
                  );

                  return href ? (
                    <Link key={item.id} href={href} className={rowClassName}>
                      {content}
                    </Link>
                  ) : (
                    <div key={item.id} className={rowClassName}>
                      {content}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
