import { rotateApiKeyService } from '@/features/api-keys/services/api-key.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string }> };

/**
 * Phase 11 — rotate an API key's secret in place (same id/name/scopes). The
 * new plaintext is returned once; the previous secret stops working
 * immediately.
 */
export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  return apiSuccess(await rotateApiKeyService(id));
});
