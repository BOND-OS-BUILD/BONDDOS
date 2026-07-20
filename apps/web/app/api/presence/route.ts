import { requireAuth } from '@bond-os/auth';
import { presenceHeartbeatSchema } from '@bond-os/shared';
import { withRateLimit } from '@bond-os/shared/server';

import { recordPresenceHeartbeat } from '@/features/collaboration/services/presence.service';
import { apiHandler, apiSuccess, parseJsonBody } from '@/lib/api-handler';
import { assertSameOrigin } from '@/lib/csrf';
import { requireActiveOrganizationId } from '@/lib/organization';

/**
 * Presence heartbeat (Phase 9) — a client POSTs this every ~15s while a page
 * is open. Writes straight to `Cache`, never Postgres. Rate-limited tighter
 * than a normal write endpoint's default since it's expected to fire
 * frequently and legitimately, but still bounded against a runaway client.
 * See docs/presence.md.
 */
export const POST = apiHandler(
  withRateLimit(
    async (request) => {
      assertSameOrigin(request);
      const { user } = await requireAuth();
      const organizationId = await requireActiveOrganizationId();
      const body = await parseJsonBody(request, presenceHeartbeatSchema);

      await recordPresenceHeartbeat({
        organizationId,
        page: body.page,
        status: body.status,
        entityId: body.entityId,
        cursor: body.cursor,
        user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null },
      });

      return apiSuccess({ ok: true });
    },
    { limit: 8, windowSeconds: 60 },
  ),
);
