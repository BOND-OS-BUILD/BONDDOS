import { requireAuth } from '@bond-os/auth';
import { collaborationStreamQuerySchema, ValidationError } from '@bond-os/shared';

import { channelStream } from '@/features/collaboration/lib/realtime-channel';
import { getPresenceSnapshot } from '@/features/collaboration/services/presence.service';
import { apiHandler, parseQueryParams } from '@/lib/api-handler';
import { requireActiveOrganizationId } from '@/lib/organization';
import { createSseStream } from '@/lib/streaming-handler';

/**
 * The generic realtime channel entry point (Phase 9) — the client only ever
 * sends a `type` plus minimal scoping params (e.g. `page`); the actual Cache
 * channel key is built here from the caller's OWN `organizationId`/`userId`,
 * never from client input, so a channel key can never be steered into
 * reading another org's or another user's data. `maxDuration = 30` is the
 * first use of this export in the codebase — see docs/collaboration.md for
 * the connection-pooler prerequisite this implies for real multi-user
 * deployment. See docs/presence.md.
 */
export const maxDuration = 30;

export const GET = apiHandler(async (request) => {
  await requireAuth();
  const organizationId = await requireActiveOrganizationId();
  const query = parseQueryParams(request, collaborationStreamQuerySchema);

  const { channelKey, fetchSnapshot } = resolveChannel(query, organizationId);

  const generator = channelStream(channelKey, fetchSnapshot);
  // Primed here, inside apiHandler's try/catch, so a validation error still
  // returns a normal JSON error response — see streaming-handler.ts's doc
  // comment. `resolveChannel` itself already validated eagerly above, but
  // priming keeps this route structurally identical to every other SSE
  // route in the codebase.
  const first = await generator.next();

  return createSseStream(generator, first);
});

function resolveChannel(
  query: { type: string; page?: string },
  organizationId: string,
): { channelKey: string; fetchSnapshot: () => Promise<unknown> } {
  switch (query.type) {
    case 'presence': {
      if (!query.page) throw new ValidationError('`page` is required for the presence channel.');
      const page = query.page;
      return {
        channelKey: `presence:org:${organizationId}:page:${page}`,
        fetchSnapshot: () => getPresenceSnapshot(organizationId, page),
      };
    }
    default:
      throw new ValidationError(`Unsupported channel type: ${query.type}`);
  }
}
