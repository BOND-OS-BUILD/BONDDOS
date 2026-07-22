import { getServerSession } from '@bond-os/auth';
import { reportClientErrorSchema } from '@bond-os/shared';

import { captureError } from '@/features/errors/services/error-reporting.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';

/**
 * Phase 10 — client-side error intake. The React error boundaries
 * (app/error.tsx, app/global-error.tsx) POST here so browser errors join the
 * same grouped error store as server errors. Any authenticated (or even
 * anonymous, same-origin) client may report; viewing is platform-admin-only.
 */
export const dynamic = 'force-dynamic';

export const POST = apiHandler(async (request) => {
  assertSameOrigin(request);
  const body = await parseJsonBody(request, reportClientErrorSchema);
  const session = await getServerSession();
  await captureError({
    source: 'client',
    message: body.message,
    stack: body.stack ?? null,
    url: body.url ?? null,
    statusCode: null,
    userAgent: request.headers.get('user-agent'),
    userId: session?.user.id ?? null,
  });
  return apiSuccess({ received: true });
});
