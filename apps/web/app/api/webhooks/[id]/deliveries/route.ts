import { paginationQuerySchema } from '@bond-os/shared';

import { listWebhookDeliveriesService } from '@/features/webhooks/services/webhook.service';
import { apiHandler, apiSuccess, parseQueryParams } from '@/lib/api-handler';

type Context = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export const GET = apiHandler<Context>(async (request, { params }) => {
  const { id } = await params;
  const query = parseQueryParams(request, paginationQuerySchema);
  return apiSuccess(
    await listWebhookDeliveriesService({ subscriptionId: id, page: query.page, pageSize: query.pageSize }),
  );
});
