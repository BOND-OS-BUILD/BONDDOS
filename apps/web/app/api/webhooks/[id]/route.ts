import { updateWebhookSchema } from '@bond-os/shared';

import { deleteWebhookService, updateWebhookService } from '@/features/webhooks/services/webhook.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export const PATCH = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const body = await parseJsonBody(request, updateWebhookSchema);
  return apiSuccess(await updateWebhookService(id, body));
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  await deleteWebhookService(id);
  return apiSuccess({ id });
});
