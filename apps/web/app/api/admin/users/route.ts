import { z } from 'zod';

import { setAdminUserPlatformAdmin } from '@/features/admin/services/admin.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/** Phase 10 — platform-admin: grant/revoke another user's platform-admin flag. */
export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  userId: z.string().min(1),
  isPlatformAdmin: z.boolean(),
});

export const PATCH = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, patchSchema);
  await setAdminUserPlatformAdmin(body.userId, body.isPlatformAdmin);
  return apiSuccess({ updated: true });
});
