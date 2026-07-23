import { createApiKeySchema } from '@bond-os/shared';

import { createApiKeyService, listApiKeysService } from '@/features/api-keys/services/api-key.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/**
 * Phase 11 — API key management (session-authenticated). Authorization is
 * enforced inside the service (org membership + role for ORGANIZATION keys).
 * The plaintext secret is returned only from POST, exactly once.
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  return apiSuccess(await listApiKeysService());
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, createApiKeySchema);
  return apiSuccess(await createApiKeyService(body), { status: 201 });
});
