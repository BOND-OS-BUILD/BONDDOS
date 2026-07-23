/**
 * Public types for the BOND OS Extension SDK. Kept intentionally light and
 * forward-compatible: domain objects expose their well-known fields and allow
 * additional properties, so new API fields never break a typed client.
 */

export interface BondClientConfig {
  /** An API key of the form `bond_sk_…` (Settings → API keys). */
  apiKey: string;
  /**
   * Base URL of the BOND OS instance, e.g. `https://app.example.com`. Optional
   * in the browser (defaults to the current origin); required in Node.
   */
  baseUrl?: string;
  /** Override the fetch implementation (tests, edge runtimes, proxies). */
  fetch?: typeof fetch;
  /** Extra headers sent on every request. */
  headers?: Record<string, string>;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResult<T> = { success: true; data: T } | { success: false; error: ApiErrorBody };

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  sortDir?: 'asc' | 'desc';
}

/** Thrown for non-2xx responses and `{ success: false }` envelopes. */
export class BondApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = 'BondApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// ── Domain shapes (well-known fields + open for forward compatibility) ──────

export interface WithId {
  id: string;
  [key: string]: unknown;
}
export type Project = WithId;
export type Task = WithId;
export type Document = WithId;
export type Customer = WithId;
export type Meeting = WithId;
export type Notification = WithId;
export type WorkflowDefinition = WithId;

export interface SearchResults {
  projects: WithId[];
  tasks: WithId[];
  documents: WithId[];
  meetings: WithId[];
  customers: WithId[];
  library: WithId[];
}

export interface GraphAnalytics {
  [key: string]: unknown;
}

export interface CustomObjectSummary {
  key: string;
  name: string;
  pluralName: string | null;
  description: string | null;
  fieldCount: number;
}

export interface CustomRecord {
  id: string;
  title: string;
  values: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ApiIdentity {
  name: string;
  version: string;
  organizationId: string;
  keyType: 'PERSONAL' | 'ORGANIZATION';
  scopes: string[];
  documentation: string;
  openapi: string;
  resources: Record<string, string>;
}
