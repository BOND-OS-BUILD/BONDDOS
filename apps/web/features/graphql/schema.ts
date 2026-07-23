import { buildSchema } from 'graphql';

import {
  customerQuerySchema,
  documentQuerySchema,
  meetingQuerySchema,
  projectQuerySchema,
  taskQuerySchema,
} from '@bond-os/shared';

import { requireScope, type ApiKeyContext } from '@/features/api-keys/auth/api-auth';
import {
  graphAnalyticsPublic,
  listCustomersPublic,
  listDocumentsPublic,
  listMeetingsPublic,
  listProjectsPublic,
  listTasksPublic,
  searchPublic,
} from '@/features/api-v1/services/public-resources.service';
import { listCustomObjectsPublic } from '@/features/api-v1/services/custom-objects-public.service';

/**
 * Phase 11 — optional, read-only GraphQL surface. It authenticates with the
 * same API keys as the REST API, enforces the same per-field scopes, and reuses
 * the SAME repositories (via the public read services) — so it can never read
 * more than the REST API, or cross an organization boundary. `JSON` domain
 * objects are passed through as-is (a scalar) to avoid duplicating every field
 * definition that already lives in the REST layer.
 */

export const graphqlSchema = buildSchema(/* GraphQL */ `
  scalar JSON

  type Page {
    items: [JSON!]!
    page: Int!
    pageSize: Int!
    total: Int!
    totalPages: Int!
  }

  type SearchResult {
    projects: [JSON!]!
    tasks: [JSON!]!
    documents: [JSON!]!
    meetings: [JSON!]!
    customers: [JSON!]!
    library: [JSON!]!
  }

  type CustomObjectSummary {
    key: String!
    name: String!
    pluralName: String
    description: String
    fieldCount: Int!
  }

  type Query {
    projects(page: Int, pageSize: Int, search: String): Page!
    tasks(page: Int, pageSize: Int, search: String): Page!
    documents(page: Int, pageSize: Int, search: String): Page!
    customers(page: Int, pageSize: Int, search: String): Page!
    meetings(page: Int, pageSize: Int, search: String): Page!
    search(q: String!): SearchResult!
    graphAnalytics: JSON
    customObjects: [CustomObjectSummary!]!
  }
`);

interface PageArgs {
  page?: number;
  pageSize?: number;
  search?: string;
}

/** Root resolvers. `context` is the authenticated, org-scoped API key context. */
export function createRootValue(context: ApiKeyContext) {
  const orgId = context.organizationId;
  return {
    projects: (args: PageArgs) => {
      requireScope(context, 'projects:read');
      return listProjectsPublic(orgId, projectQuerySchema.parse(args));
    },
    tasks: (args: PageArgs) => {
      requireScope(context, 'tasks:read');
      return listTasksPublic(orgId, taskQuerySchema.parse(args));
    },
    documents: (args: PageArgs) => {
      requireScope(context, 'documents:read');
      return listDocumentsPublic(orgId, documentQuerySchema.parse(args));
    },
    customers: (args: PageArgs) => {
      requireScope(context, 'customers:read');
      return listCustomersPublic(orgId, customerQuerySchema.parse(args));
    },
    meetings: (args: PageArgs) => {
      requireScope(context, 'meetings:read');
      return listMeetingsPublic(orgId, meetingQuerySchema.parse(args));
    },
    search: (args: { q: string }) => {
      requireScope(context, 'search:read');
      return searchPublic(orgId, args.q);
    },
    graphAnalytics: () => {
      requireScope(context, 'graph:read');
      return graphAnalyticsPublic(orgId);
    },
    customObjects: () => {
      requireScope(context, 'custom-objects:read');
      return listCustomObjectsPublic(orgId);
    },
  };
}
