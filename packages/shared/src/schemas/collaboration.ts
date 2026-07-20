import { z } from 'zod';

/**
 * Phase 9 — Enterprise Collaboration. Presence heartbeats and the realtime
 * channel primitive. See docs/presence.md, docs/collaboration.md.
 */

export const presenceStatusSchema = z.enum(['online', 'idle', 'busy']);
export type PresenceStatus = z.infer<typeof presenceStatusSchema>;

export const presenceHeartbeatSchema = z.object({
  page: z.string().trim().min(1).max(200),
  status: presenceStatusSchema.default('online'),
  entityId: z.string().trim().min(1).max(200).optional(),
  cursor: z.object({ x: z.number(), y: z.number() }).optional(),
});
export type PresenceHeartbeatInput = z.infer<typeof presenceHeartbeatSchema>;

/**
 * The client never supplies a raw channel key — only a `type` plus the
 * minimal scoping params that type needs (e.g. `page` for presence). The
 * route builds the real Cache key server-side from the caller's own
 * `organizationId`/`userId`, so a channel key can never be used to read
 * another org's or another user's data.
 */
export const collaborationStreamTypeSchema = z.enum(['presence', 'notifications', 'activity', 'dashboard']);
export type CollaborationStreamType = z.infer<typeof collaborationStreamTypeSchema>;

export const collaborationStreamQuerySchema = z.object({
  type: collaborationStreamTypeSchema,
  page: z.string().trim().min(1).max(200).optional(),
});
export type CollaborationStreamQuery = z.infer<typeof collaborationStreamQuerySchema>;
