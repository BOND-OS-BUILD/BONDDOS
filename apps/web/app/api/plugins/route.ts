import { pluginManifestSchema } from '@bond-os/shared';

import { installPluginService, listPluginsService } from '@/features/plugins/services/plugin.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/**
 * Phase 11 — plugins. GET lists the org's installed plugins (MEMBER); POST
 * installs a plugin from a manifest (ADMIN). Manifest validation + the security
 * re-check happen in the service.
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  return apiSuccess(await listPluginsService());
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const manifest = await parseJsonBody(request, pluginManifestSchema);
  return apiSuccess(await installPluginService(manifest), { status: 201 });
});
