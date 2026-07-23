import { API_SCOPES } from '@bond-os/shared';

/**
 * Phase 11 — the public API's OpenAPI 3.1 description. Hand-authored (rather
 * than reflected) so it stays readable and reviewable; served verbatim at
 * `/api/v1/openapi.json` and rendered by Swagger UI at `/api/v1/docs`.
 * Response bodies use the standard `ApiResponse` envelope
 * (`{ success, data }` / `{ success, error }`).
 */

const PAGINATION_PARAMS = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
  { name: 'search', in: 'query', schema: { type: 'string' } },
  { name: 'sortDir', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
] as const;

interface CollectionDef {
  path: string;
  tag: string;
  name: string;
  scope: string;
  hasDetail: boolean;
}

const COLLECTIONS: CollectionDef[] = [
  { path: 'projects', tag: 'Projects', name: 'project', scope: 'projects:read', hasDetail: true },
  { path: 'tasks', tag: 'Tasks', name: 'task', scope: 'tasks:read', hasDetail: true },
  { path: 'documents', tag: 'Documents', name: 'document', scope: 'documents:read', hasDetail: true },
  { path: 'customers', tag: 'Customers', name: 'customer', scope: 'customers:read', hasDetail: true },
  { path: 'meetings', tag: 'Meetings', name: 'meeting', scope: 'meetings:read', hasDetail: true },
];

const STANDARD_ERRORS = {
  '401': { $ref: '#/components/responses/Unauthorized' },
  '403': { $ref: '#/components/responses/Forbidden' },
  '429': { $ref: '#/components/responses/RateLimited' },
};

function paginatedResponse(itemName: string) {
  return {
    description: `A paginated list of ${itemName}s.`,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            data: {
              type: 'object',
              properties: {
                items: { type: 'array', items: { type: 'object' } },
                page: { type: 'integer' },
                pageSize: { type: 'integer' },
                total: { type: 'integer' },
                totalPages: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  };
}

function objectResponse(description: string) {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: { success: { type: 'boolean', example: true }, data: { type: 'object' } },
        },
      },
    },
  };
}

export function buildOpenApiDocument(baseUrl: string): Record<string, unknown> {
  const paths: Record<string, unknown> = {};

  paths['/api/v1'] = {
    get: {
      tags: ['Discovery'],
      summary: 'API root — lists available resources and the caller’s context',
      security: [{ bearerAuth: [] }],
      responses: { '200': objectResponse('Discovery document.'), ...STANDARD_ERRORS },
    },
  };

  for (const c of COLLECTIONS) {
    paths[`/api/v1/${c.path}`] = {
      get: {
        tags: [c.tag],
        summary: `List ${c.name}s`,
        description: `Requires the \`${c.scope}\` scope.`,
        security: [{ bearerAuth: [] }],
        parameters: PAGINATION_PARAMS,
        responses: { '200': paginatedResponse(c.name), ...STANDARD_ERRORS },
      },
    };
    if (c.hasDetail) {
      paths[`/api/v1/${c.path}/{id}`] = {
        get: {
          tags: [c.tag],
          summary: `Get a ${c.name} by id`,
          description: `Requires the \`${c.scope}\` scope.`,
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': objectResponse(`A single ${c.name}.`),
            '404': { $ref: '#/components/responses/NotFound' },
            ...STANDARD_ERRORS,
          },
        },
      };
    }
  }

  paths['/api/v1/search'] = {
    get: {
      tags: ['Search'],
      summary: 'Search across projects, tasks, documents, meetings, customers and the knowledge graph',
      description: 'Requires the `search:read` scope.',
      security: [{ bearerAuth: [] }],
      parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
      responses: { '200': objectResponse('Grouped search results.'), ...STANDARD_ERRORS },
    },
  };

  paths['/api/v1/graph'] = {
    get: {
      tags: ['Knowledge Graph'],
      summary: 'Knowledge graph analytics for the organization',
      description: 'Requires the `graph:read` scope.',
      security: [{ bearerAuth: [] }],
      responses: { '200': objectResponse('Graph analytics.'), ...STANDARD_ERRORS },
    },
  };

  paths['/api/v1/notifications'] = {
    get: {
      tags: ['Notifications'],
      summary: 'List the key owner’s notifications (personal keys only)',
      description: 'Requires the `notifications:read` scope and a PERSONAL API key.',
      security: [{ bearerAuth: [] }],
      parameters: [
        ...PAGINATION_PARAMS,
        { name: 'read', in: 'query', schema: { type: 'boolean' } },
        { name: 'archived', in: 'query', schema: { type: 'boolean' } },
        {
          name: 'category',
          in: 'query',
          schema: {
            type: 'string',
            enum: ['assigned', 'mentions', 'approvals', 'ai_insights', 'workflow_events', 'activity'],
          },
        },
      ],
      responses: { '200': paginatedResponse('notification'), ...STANDARD_ERRORS },
    },
  };

  const errorSchema = {
    type: 'object',
    properties: {
      success: { type: 'boolean', example: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          details: {},
        },
      },
    },
  };

  function errorResponse(description: string) {
    return { description, content: { 'application/json': { schema: errorSchema } } };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: 'BOND OS Public API',
      version: '1.0.0',
      description:
        'Read access to your organization’s BOND OS data. Authenticate with an API key ' +
        '(`Authorization: Bearer bond_sk_…`) minted in Settings → API keys. Every request is ' +
        'scoped to the key’s organization; scopes gate which resources a key may read.',
    },
    servers: [{ url: baseUrl }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Discovery' },
      { name: 'Projects' },
      { name: 'Tasks' },
      { name: 'Documents' },
      { name: 'Customers' },
      { name: 'Meetings' },
      { name: 'Search' },
      { name: 'Knowledge Graph' },
      { name: 'Notifications' },
    ],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'An API key of the form `bond_sk_…`. Manage keys in Settings → API keys.',
        },
      },
      responses: {
        Unauthorized: errorResponse('Missing, malformed, revoked, or expired API key.'),
        Forbidden: errorResponse('The key is missing the scope required for this endpoint.'),
        NotFound: errorResponse('The requested resource does not exist in this organization.'),
        RateLimited: errorResponse('Rate limit exceeded for this key.'),
      },
      schemas: {
        ApiError: errorSchema,
        Scopes: {
          type: 'string',
          enum: API_SCOPES.map((s) => s.scope),
          description: 'Available API scopes.',
        },
      },
    },
  };
}
