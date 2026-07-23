import { createWebhookSchema } from '@bond-os/shared';

import { createWebhookService, listWebhooksService } from '@/features/webhooks/services/webhook.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/**
 * Phase 11 — outbound webhook management (session-authenticated, ADMIN-only —
 * enforced in the service). The signing secret is returned only from POST.
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  return apiSuccess(await listWebhooksService());
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, createWebhookSchema);
  return apiSuccess(await createWebhookService(body), { status: 201 });
});
