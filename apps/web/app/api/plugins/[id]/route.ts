import { getPluginService, uninstallPluginService } from '@/features/plugins/services/plugin.service';
import { apiHandler, apiSuccess } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string }> };

export const dynamic = 'force-dynamic';

export const GET = apiHandler<Context>(async (_request, { params }) => {
  const { id } = await params;
  return apiSuccess(await getPluginService(id));
});

export const DELETE = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  await uninstallPluginService(id);
  return apiSuccess({ id });
});
