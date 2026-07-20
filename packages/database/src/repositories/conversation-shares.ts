import { prisma } from '../client';
import type { Prisma, SharePermission } from '../generated/index.js';
import { toUserSummaryOrNull, userSummarySelect, type UserSummary } from './shared';

/**
 * Shared AI Sessions (Phase 9) — introduces default-private `Conversation`
 * access. Before this model existed, `Conversation` had NO ownership gate:
 * any org member could already read/rename/delete any other member's
 * conversation by id. The access decision itself (`createdById === callerId
 * OR an active share OR caller role >= ADMIN`) is made in
 * `conversation.service.ts`, not here — this repository only stores and
 * looks up share grants. Always to a specific org member, never public/
 * cross-organization. See docs/shared-ai.md.
 */

export interface ConversationShareData {
  id: string;
  organizationId: string;
  conversationId: string;
  sharedWithUserId: string;
  sharedWith: UserSummary;
  permission: SharePermission;
  sharedBy: UserSummary | null;
  createdAt: Date;
}

const shareInclude = {
  sharedWith: { select: userSummarySelect },
  sharedBy: { select: userSummarySelect },
} satisfies Prisma.ConversationShareInclude;

type ShareWithRelations = Prisma.ConversationShareGetPayload<{ include: typeof shareInclude }>;

function toItem(share: ShareWithRelations): ConversationShareData {
  return {
    id: share.id,
    organizationId: share.organizationId,
    conversationId: share.conversationId,
    sharedWithUserId: share.sharedWithUserId,
    sharedWith: toUserSummaryOrNull(share.sharedWith) as UserSummary,
    permission: share.permission,
    sharedBy: toUserSummaryOrNull(share.sharedBy),
    createdAt: share.createdAt,
  };
}

export interface ShareConversationData {
  organizationId: string;
  conversationId: string;
  sharedWithUserId: string;
  permission: SharePermission;
  sharedById?: string | null;
}

/** Upserted on the `[conversationId, sharedWithUserId]` unique constraint — re-sharing with the same person updates their permission rather than erroring or duplicating. */
export async function upsertConversationShare(data: ShareConversationData): Promise<ConversationShareData> {
  const share = await prisma.conversationShare.upsert({
    where: { conversationId_sharedWithUserId: { conversationId: data.conversationId, sharedWithUserId: data.sharedWithUserId } },
    create: data,
    update: { permission: data.permission, sharedById: data.sharedById },
    include: shareInclude,
  });
  return toItem(share);
}

export async function listSharesForConversation(conversationId: string, organizationId: string): Promise<ConversationShareData[]> {
  const shares = await prisma.conversationShare.findMany({
    where: { conversationId, organizationId },
    orderBy: { createdAt: 'asc' },
    include: shareInclude,
  });
  return shares.map(toItem);
}

/** The access-check primitive `conversation.service.ts` calls: does this specific user have an active share on this conversation? */
export async function getConversationShareForUser(conversationId: string, sharedWithUserId: string): Promise<ConversationShareData | null> {
  const share = await prisma.conversationShare.findUnique({
    where: { conversationId_sharedWithUserId: { conversationId, sharedWithUserId } },
    include: shareInclude,
  });
  return share ? toItem(share) : null;
}

export async function removeConversationShare(conversationId: string, organizationId: string, sharedWithUserId: string): Promise<boolean> {
  const result = await prisma.conversationShare.deleteMany({ where: { conversationId, organizationId, sharedWithUserId } });
  return result.count > 0;
}
