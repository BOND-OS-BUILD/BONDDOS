import { apiV1Handler } from '@/features/api-keys/auth/api-auth';
import { apiSuccess } from '@/lib/api-handler';

/**
 * Phase 11 — public API discovery. Any valid key may call it (no specific
 * scope). Returns the caller's resolved context and the resource index so a
 * client can self-orient. Full contract lives at `/api/v1/openapi.json`.
 */
export const dynamic = 'force-dynamic';

export const GET = apiV1Handler(null, async (request, apiContext) => {
  const origin = new URL(request.url).origin;
  return apiSuccess({
    name: 'BOND OS Public API',
    version: 'v1',
    organizationId: apiContext.organizationId,
    keyType: apiContext.userId ? 'PERSONAL' : 'ORGANIZATION',
    scopes: apiContext.scopes,
    documentation: `${origin}/api/v1/docs`,
    openapi: `${origin}/api/v1/openapi.json`,
    resources: {
      projects: `${origin}/api/v1/projects`,
      tasks: `${origin}/api/v1/tasks`,
      documents: `${origin}/api/v1/documents`,
      customers: `${origin}/api/v1/customers`,
      meetings: `${origin}/api/v1/meetings`,
      search: `${origin}/api/v1/search?q=`,
      graph: `${origin}/api/v1/graph`,
      notifications: `${origin}/api/v1/notifications`,
    },
  });
});
