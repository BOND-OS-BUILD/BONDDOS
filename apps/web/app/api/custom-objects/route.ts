import { createObjectDefinitionSchema } from '@bond-os/shared';

import { createCustomObjectService, listCustomObjectsService } from '@/features/custom-objects/services/custom-object.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/** Phase 11 — custom object definitions. Create/alter is ADMIN (in the service). */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  return apiSuccess(await listCustomObjectsService());
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, createObjectDefinitionSchema);
  return apiSuccess(await createCustomObjectService(body), { status: 201 });
});
