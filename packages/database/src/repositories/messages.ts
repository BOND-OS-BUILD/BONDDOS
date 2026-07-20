import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import { Prisma, type MessageRole } from '../generated/index.js';
import { toUserSummaryOrNull, userSummarySelect, type UserSummary } from './shared';

/** Chat turns (Phase 5 "Mr. Bond"). `organizationId` is denormalized directly onto the row — see the schema comment. See docs/chat.md. */

export interface MessageItem {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  citations: unknown;
  metadata: unknown;
  tokenUsage: unknown;
  model: string | null;
  user: UserSummary | null;
  createdAt: Date;
}

const messageInclude = {
  user: { select: userSummarySelect },
} satisfies Prisma.MessageInclude;

type MessageWithRelations = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;

function toItem(message: MessageWithRelations): MessageItem {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    citations: message.citations,
    metadata: message.metadata,
    tokenUsage: message.tokenUsage,
    model: message.model,
    user: toUserSummaryOrNull(message.user),
    createdAt: message.createdAt,
  };
}

export interface ListMessagesFilters {
  conversationId: string;
  organizationId: string;
  page: number;
  pageSize: number;
}

/** Oldest-first (chat reading order) — unlike every other paginated list in this codebase, which is newest-first. */
export async function listMessages(filters: ListMessagesFilters): Promise<PaginatedResult<MessageItem>> {
  const { conversationId, organizationId, page, pageSize } = filters;
  const where: Prisma.MessageWhereInput = { conversationId, organizationId };

  const [items, total] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: messageInclude,
    }),
    prisma.message.count({ where }),
  ]);

  return {
    items: items.map(toItem),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Most recent N turns, returned oldest-first — the shape `conversation-memory.service.ts` needs to fold into a prompt's message array. */
export async function getRecentMessages(
  conversationId: string,
  organizationId: string,
  limit: number,
): Promise<MessageItem[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId, organizationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: messageInclude,
  });
  return rows.reverse().map(toItem);
}

export interface CreateMessageData {
  conversationId: string;
  organizationId: string;
  userId?: string | null;
  role: MessageRole;
  content: string;
  citations?: Prisma.InputJsonValue;
  metadata?: Prisma.InputJsonValue;
  tokenUsage?: Prisma.InputJsonValue;
  model?: string | null;
}

export async function createMessage(data: CreateMessageData): Promise<MessageItem> {
  const created = await prisma.message.create({ data, include: messageInclude });
  return toItem(created);
}

export async function getMessageById(id: string, organizationId: string): Promise<MessageItem | null> {
  const message = await prisma.message.findFirst({ where: { id, organizationId }, include: messageInclude });
  return message ? toItem(message) : null;
}

/** Every entity a conversation's citations have touched, deduplicated — the deterministic "entity memory" aggregation `conversation-memory.service.ts` uses. */
export async function getCitationRefsForConversation(conversationId: string, organizationId: string): Promise<unknown[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId, organizationId, citations: { not: Prisma.JsonNull } },
    select: { citations: true },
  });
  return rows.map((row) => row.citations).filter((citations): citations is NonNullable<typeof citations> => citations !== null);
}

export interface MessageCostAggregate {
  model: string | null;
  tokenUsage: unknown;
  createdAt: Date;
  /** Carries `{ agentKey }` for agent-authored turns (Phase 7) — absent/other shape for Phase 5 Bond-only rows predating agents. `cost-tracking.service.ts` reads this to group by agent; the repository stays agent-agnostic. */
  metadata: unknown;
}

/**
 * Raw per-message token usage for `cost-tracking.service.ts` to sum — kept as
 * a thin read so the cost math itself stays outside the repository layer.
 * ASSISTANT rows carry the token usage but have `userId: null` (only a USER
 * message has an author) — "per user" cost is attributed via the owning
 * Conversation's `createdById` instead, not `Message.userId`.
 */
export async function listMessageTokenUsage(
  organizationId: string,
  filters: { conversationId?: string; userId?: string; since?: Date } = {},
): Promise<MessageCostAggregate[]> {
  const { conversationId, userId, since } = filters;
  const rows = await prisma.message.findMany({
    where: {
      organizationId,
      role: 'ASSISTANT',
      tokenUsage: { not: Prisma.JsonNull },
      ...(conversationId && { conversationId }),
      ...(userId && { conversation: { createdById: userId } }),
      ...(since && { createdAt: { gte: since } }),
    },
    select: { model: true, tokenUsage: true, createdAt: true, metadata: true },
  });
  return rows;
}
