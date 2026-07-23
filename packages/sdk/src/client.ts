import { HttpClient } from './http';
import type {
  ApiIdentity,
  BondClientConfig,
  CustomObjectSummary,
  CustomRecord,
  Customer,
  Document as BondDocument,
  GraphAnalytics,
  ListQuery,
  Meeting,
  Notification,
  Paginated,
  Project,
  SearchResults,
  Task,
  WorkflowDefinition,
} from './types';

/** A read collection with an optional single-resource getter. */
interface ReadResource<T> {
  list(query?: ListQuery): Promise<Paginated<T>>;
  get(id: string): Promise<T>;
}

function readResource<T>(http: HttpClient, path: string): ReadResource<T> {
  return {
    list: (query) => http.get<Paginated<T>>(path, query as Record<string, unknown>),
    get: (id) => http.get<T>(`${path}/${encodeURIComponent(id)}`),
  };
}

export interface BondClient {
  /** The key's identity, scopes and resource index. */
  identity(): Promise<ApiIdentity>;
  projects: ReadResource<Project>;
  tasks: ReadResource<Task>;
  documents: ReadResource<BondDocument>;
  customers: ReadResource<Customer>;
  meetings: ReadResource<Meeting>;
  search(query: string): Promise<SearchResults>;
  graph: { analytics(): Promise<GraphAnalytics> };
  notifications: { list(query?: ListQuery & { read?: boolean; archived?: boolean; category?: string }): Promise<Paginated<Notification>> };
  workflows: { list(query?: ListQuery): Promise<Paginated<WorkflowDefinition>> };
  customObjects: {
    list(): Promise<CustomObjectSummary[]>;
    records(objectKey: string): {
      list(query?: ListQuery): Promise<Paginated<CustomRecord>>;
      create(input: { title?: string; values: Record<string, unknown> }): Promise<CustomRecord>;
    };
  };
  /** Escape hatch for any endpoint not yet wrapped. */
  raw: HttpClient;
}

/**
 * Create a typed BOND OS client.
 *
 * ```ts
 * const bond = createClient({ apiKey: process.env.BOND_OS_API_KEY!, baseUrl: 'https://app.example.com' });
 * const { items } = await bond.projects.list({ pageSize: 50 });
 * ```
 */
export function createClient(config: BondClientConfig): BondClient {
  const http = new HttpClient(config);
  return {
    identity: () => http.get<ApiIdentity>('/api/v1'),
    projects: readResource<Project>(http, '/api/v1/projects'),
    tasks: readResource<Task>(http, '/api/v1/tasks'),
    documents: readResource<BondDocument>(http, '/api/v1/documents'),
    customers: readResource<Customer>(http, '/api/v1/customers'),
    meetings: readResource<Meeting>(http, '/api/v1/meetings'),
    search: (query) => http.get<SearchResults>('/api/v1/search', { q: query }),
    graph: { analytics: () => http.get<GraphAnalytics>('/api/v1/graph') },
    notifications: {
      list: (query) => http.get<Paginated<Notification>>('/api/v1/notifications', query as Record<string, unknown>),
    },
    workflows: {
      list: (query) => http.get<Paginated<WorkflowDefinition>>('/api/v1/workflows', query as Record<string, unknown>),
    },
    customObjects: {
      list: () => http.get<CustomObjectSummary[]>('/api/v1/custom-objects'),
      records: (objectKey) => {
        const base = `/api/v1/custom-objects/${encodeURIComponent(objectKey)}/records`;
        return {
          list: (query) => http.get<Paginated<CustomRecord>>(base, query as Record<string, unknown>),
          create: (input) => http.post<CustomRecord>(base, input),
        };
      },
    },
    raw: http,
  };
}
