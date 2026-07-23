import { pluginManifestSchema } from '@bond-os/shared';

import { upgradePluginService } from '@/features/plugins/services/plugin.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

type Context = { params: Promise<{ id: string }> };

/** Phase 11 — upgrade an installed plugin to a new validated manifest version. */
export const dynamic = 'force-dynamic';

export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const { id } = await params;
  const manifest = await parseJsonBody(request, pluginManifestSchema);
  return apiSuccess(await upgradePluginService(id, manifest));
});
