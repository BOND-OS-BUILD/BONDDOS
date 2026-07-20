import { requireAuth } from '@bond-os/auth';
import { createRelationshipSchema, relationshipQuerySchema } from '@bond-os/shared';

import { createRelationshipService, listRelationshipsService } from '@/features/graph/services/graph.service';
import { apiHandler, apiSuccess, parseJsonBody, parseQueryParams } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

/** Paginated, org-wide — backs the Relationship Explorer page. */
export const GET = apiHandler(async (request) => {
  const organizationId = await requireActiveOrganizationId();
  const { page, pageSize, relationshipType } = parseQueryParams(request, relationshipQuerySchema);
  const relationships = await listRelationshipsService(organizationId, { page, pageSize, relationshipType });
  return apiSuccess(relationships);
});

/** Manual relationship creation — the API path for the relationship types automatic detection doesn't cover. */
export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const { user } = await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const body = await parseJsonBody(request, createRelationshipSchema);
  const relationship = await createRelationshipService(organizationId, user.id, body);
  return apiSuccess(relationship, { status: 201 });
});
