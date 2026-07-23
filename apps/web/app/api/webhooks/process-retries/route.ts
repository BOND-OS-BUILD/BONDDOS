import { processWebhookRetriesService } from '@/features/webhooks/services/webhook.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/**
 * Phase 11 — process this organization's due webhook retries. There is no
 * background worker (mirrors `/api/embeddings/jobs/retry`); trigger it manually
 * from the UI or on a schedule. ADMIN-only, enforced in the service.
 */
export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  return apiSuccess(await processWebhookRetriesService());
});
