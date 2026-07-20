import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { Prisma } from '../generated/index.js';
import { toUserSummaryOrNull, userSummarySelect, type UserSummary } from './shared';

/** Chat threads (Phase 5 "Mr. Bond"). See docs/conversations.md. */

export interface ConversationListItem {
  id: string;
  title: string | null;
  pinned: boolean;
  archived: boolean;
  createdBy: UserSummary | null;
  messageCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const listInclude = {
  createdBy: { select: userSummarySelect },
  _count: { select: { messages: true } },
  messages: { orderBy: { createdAt: 'desc' as const }, take: 1, select: { createdAt: true } },
} satisfies Prisma.ConversationInclude;

type ConversationWithRelations = Prisma.ConversationGetPayload<{ include: typeof listInclude }>;

function toListItem(conversation: ConversationWithRelations): ConversationListItem {
  return {
    id: conversation.id,
    title: conversation.title,
    pinned: conversation.pinned,
    archived: conversation.archived,
    createdBy: toUserSummaryOrNull(conversation.createdBy),
    messageCount: conversation._count.messages,
    lastMessageAt: conversation.messages[0]?.createdAt ?? null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

export interface ConversationListFilters {
  organizationId: string;
  userId?: string;
  page: number;
  pageSize: number;
  archived?: boolean;
  search?: string;
}

/** `userId`, when passed, scopes to conversations that user created — the conversation list sidebar only ever shows the caller's own threads, never every org member's. */
export async function listConversations(filters: ConversationListFilters): Promise<PaginatedResult<ConversationListItem>> {
  const { organizationId, userId, page, pageSize, archived, search } = filters;

  const where: Prisma.ConversationWhereInput = {
    organizationId,
    ...(userId && { createdById: userId }),
    ...(archived !== undefined && { archived }),
    ...(search && { title: { contains: search, mode: 'insensitive' } }),
  };

  const [items, total] = await Promise.all([
    prisma.conversation.findMany({
      where,
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: listInclude,
    }),
    prisma.conversation.count({ where }),
  ]);

  return {
    items: items.map(toListItem),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getConversationById(id: string, organizationId: string): Promise<ConversationListItem | null> {
  const conversation = await prisma.conversation.findFirst({ where: { id, organizationId }, include: listInclude });
  return conversation ? toListItem(conversation) : null;
}

export interface CreateConversationData {
  organizationId: string;
  createdById?: string | null;
  title?: string | null;
}

export function createConversation(data: CreateConversationData) {
  return prisma.conversation.create({ data });
}

export interface UpdateConversationData {
  title?: string | null;
  pinned?: boolean;
  archived?: boolean;
}

export async function updateConversation(
  id: string,
  organizationId: string,
  data: UpdateConversationData,
): Promise<boolean> {
  const result = await prisma.conversation.updateMany({ where: { id, organizationId }, data });
  return result.count > 0;
}

export async function touchConversation(id: string, organizationId: string): Promise<void> {
  await prisma.conversation.updateMany({ where: { id, organizationId }, data: { updatedAt: new Date() } });
}

/** Ownership transfer (Phase 9 Shared AI Sessions) — kept as its own function, not folded into `UpdateConversationData`, since reassigning `createdById` is a distinct, security-sensitive operation the generic update path should never accidentally trigger. */
export async function transferConversationOwnership(id: string, organizationId: string, newOwnerId: string): Promise<boolean> {
  const result = await prisma.conversation.updateMany({ where: { id, organizationId }, data: { createdById: newOwnerId } });
  return result.count > 0;
}

export async function deleteConversation(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.conversation.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}

/** Flags conversations older than `olderThan` as archived — the manual "Archive old conversations" admin action, no background worker. */
export async function archiveConversationsOlderThan(organizationId: string, olderThan: Date): Promise<number> {
  const result = await prisma.conversation.updateMany({
    where: { organizationId, archived: false, updatedAt: { lt: olderThan } },
    data: { archived: true },
  });
  return result.count;
}
