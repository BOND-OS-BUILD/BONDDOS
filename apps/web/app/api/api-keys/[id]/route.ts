import { revokeApiKeyService } from '@/features/api-keys/services/api-key.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string }> };

/** Phase 11 — revoke an API key. Idempotent; org + role checks live in the service. */
export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  return apiSuccess(await revokeApiKeyService(id));
});
