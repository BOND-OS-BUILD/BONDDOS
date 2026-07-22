import { deleteFeatureFlagSchema, setFeatureFlagSchema } from '@bond-os/shared';

import {
  deleteFeatureFlagService,
  listFeatureFlagsService,
  setFeatureFlagService,
} from '@/features/feature-flags/services/feature-flag.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/**
 * Phase 10 — platform-admin feature-flag management. Authorization
 * (`requirePlatformAdmin`) is enforced inside each service call.
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  return apiSuccess(await listFeatureFlagsService());
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, setFeatureFlagSchema);
  return apiSuccess(await setFeatureFlagService(body));
});

export const DELETE = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, deleteFeatureFlagSchema);
  await deleteFeatureFlagService(body);
  return apiSuccess({ deleted: true });
});
