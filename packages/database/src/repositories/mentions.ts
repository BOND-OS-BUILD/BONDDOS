import { prisma } from '../client';
import type { MentionType } from '../generated/index.js';

/**
 * Mentions parsed from `Comment.content` at creation time (Phase 9) — a
 * structured record, never inferred later from unstructured text. `@team`
 * resolves against `Space` membership; `@agent` mentions are
 * notification-only and never invoke the agent. See docs/comments.md.
 */

export interface MentionData {
  id: string;
  organizationId: string;
  commentId: string;
  mentionedType: MentionType;
  mentionedUserId: string | null;
  mentionedSpaceId: string | null;
  mentionedAgentKey: string | null;
  createdAt: Date;
}

export interface MentionInput {
  organizationId: string;
  commentId: string;
  mentionedType: MentionType;
  mentionedUserId?: string | null;
  mentionedSpaceId?: string | null;
  mentionedAgentKey?: string | null;
}

/** Always batched (`createMany`) — a single comment can carry several `@handles` parsed in one pass; never inserted one-by-one. */
export async function createMentions(mentions: MentionInput[]): Promise<number> {
  if (mentions.length === 0) return 0;
  const result = await prisma.mention.createMany({ data: mentions });
  return result.count;
}

export async function listMentionsForComment(commentId: string, organizationId: string): Promise<MentionData[]> {
  return prisma.mention.findMany({
    where: { commentId, organizationId },
    orderBy: { createdAt: 'asc' },
  });
}

export interface ListMentionsForUserFilters {
  organizationId: string;
  userId: string;
  page: number;
  pageSize: number;
}

/** Every USER-type mention naming this person, most recent first — the Inbox "Mentions" category reads from `Notification` (which has read/archive state), so this is a lighter-weight secondary lookup for a "mentioned in" thread view. */
export async function listMentionsForUser(filters: ListMentionsForUserFilters): Promise<MentionData[]> {
  const { organizationId, userId, page, pageSize } = filters;
  return prisma.mention.findMany({
    where: { organizationId, mentionedType: 'USER', mentionedUserId: userId },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
}
