import { deleteRateLimitPolicySchema, upsertRateLimitPolicySchema } from '@bond-os/shared';

import {
  deleteRateLimitPolicyService,
  listRateLimitPoliciesService,
  upsertRateLimitPolicyService,
} from '@/features/rate-limits/services/rate-limit.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/**
 * Phase 10 — platform-admin rate-limit policy management. Authorization is
 * enforced inside each service call (`requirePlatformAdmin`).
 */
export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  return apiSuccess(await listRateLimitPoliciesService());
});

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, upsertRateLimitPolicySchema);
  return apiSuccess(await upsertRateLimitPolicyService(body));
});

export const DELETE = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, deleteRateLimitPolicySchema);
  await deleteRateLimitPolicyService(body);
  return apiSuccess({ deleted: true });
});
