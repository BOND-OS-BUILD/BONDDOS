'use client';

import * as React from 'react';
import Link from 'next/link';

import type { SearchResults } from '@/features/search/services/search.service';
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Spinner } from '@bond-os/ui';
import { Contact, FileText, FolderKanban, Library, ListTodo, Search as SearchIcon, Video } from 'lucide-react';

type NonLibrarySectionKey = Exclude<keyof SearchResults, 'library'>;

const SECTIONS: Array<{
  key: NonLibrarySectionKey;
  label: string;
  icon: typeof SearchIcon;
  href: (id: string) => string;
  render: (item: SearchResults[NonLibrarySectionKey][number]) => React.ReactNode;
}> = [
  {
    key: 'projects',
    label: 'Projects',
    icon: FolderKanban,
    href: (id) => `/projects/${id}`,
    render: (item) => ('title' in item ? item.title : ''),
  },
  {
    key: 'tasks',
    label: 'Tasks',
    icon: ListTodo,
    href: () => '/tasks',
    render: (item) => ('title' in item ? item.title : ''),
  },
  {
    key: 'documents',
    label: 'Documents',
    icon: FileText,
    href: (id) => `/documents/${id}`,
    render: (item) => ('title' in item ? item.title : ''),
  },
  {
    key: 'meetings',
    label: 'Meetings',
    icon: Video,
    href: (id) => `/meetings/${id}`,
    render: (item) => ('title' in item ? item.title : ''),
  },
  {
    key: 'customers',
    label: 'Customers',
    icon: Contact,
    href: (id) => `/customers/${id}`,
    render: (item) => ('name' in item ? item.name : ''),
  },
];

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

export default function SearchPage() {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<SearchResults | null>(null);
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
      const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const json = await response.json();
      if (json.success) {
        setResults(json.data as SearchResults);
      }
      setIsLoading(false);
    }, 300);

    return () => clearTimeout(handle);
  }, [query]);

  const totalResults = results
    ? Object.values(results).reduce((sum, items) => sum + items.length, 0)
    : 0;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">
          Find projects, tasks, documents, meetings, customers, and Library content.
        </p>
      </div>

      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search everything…"
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
          {SECTIONS.map((section) => {
            const items = results?.[section.key] ?? [];
            if (items.length === 0) return null;

            return (
              <Card key={section.key}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <section.icon className="h-4 w-4" />
                    {section.label}
                    <Badge variant="secondary">{items.length}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {items.map((item) => (
                    <Link
                      key={item.id}
                      href={section.href(item.id)}
                      className="block rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                    >
                      {section.render(item)}
                    </Link>
                  ))}
                </CardContent>
              </Card>
            );
          })}

          {(results?.library.length ?? 0) > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                  <Library className="h-4 w-4" />
                  Library
                  <Badge variant="secondary">{results!.library.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {results!.library.map((item) => (
                  <Link
                    key={item.id}
                    href={item.knowledgeDocumentId ? `/library/${item.knowledgeDocumentId}` : '/library'}
                    className="block rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <p>{item.title}</p>
                    <p className="text-xs text-muted-foreground">{renderHighlightedSnippet(item.snippet)}</p>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
