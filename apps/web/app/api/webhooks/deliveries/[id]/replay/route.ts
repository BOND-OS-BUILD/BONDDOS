import { replayWebhookDeliveryService } from '@/features/webhooks/services/webhook.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string }> };

/** Phase 11 — replay a past delivery (clones the event into a fresh attempt). */
export const dynamic = 'force-dynamic';

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  return apiSuccess(await replayWebhookDeliveryService(id));
});
