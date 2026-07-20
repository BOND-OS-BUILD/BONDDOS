import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { CommentableEntityType, Prisma } from '../generated/index.js';
import { toUserSummaryOrNull, userSummarySelect, type UserSummary } from './shared';

/**
 * Universal comments (Phase 9) — `entityType`/`entityId` are loosely typed
 * (no hard FK), matching `Embedding.sourceType`/`sourceId`'s own precedent
 * for one table spanning genuinely unrelated source tables. `CommentAttachment`
 * lives in this file, not its own, mirroring `taskDocument`/`meetingAttendee`'s
 * own "child/join rows fold into their parent's repository file" convention.
 * See docs/comments.md.
 */

export interface CommentAttachmentData {
  id: string;
  commentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
  createdAt: Date;
}

export interface CommentData {
  id: string;
  organizationId: string;
  entityType: CommentableEntityType;
  entityId: string;
  authorId: string;
  parentCommentId: string | null;
  content: string;
  resolved: boolean;
  resolvedBy: UserSummary | null;
  resolvedAt: Date | null;
  author: UserSummary;
  attachments: CommentAttachmentData[];
  /** Only populated by `listCommentsForEntity` — `getCommentById` returns `[]`; use `listCommentsForEntity` for a full thread. */
  replies: CommentData[];
  createdAt: Date;
  updatedAt: Date;
}

const commentInclude = {
  author: { select: userSummarySelect },
  resolvedBy: { select: userSummarySelect },
  attachments: true,
} satisfies Prisma.CommentInclude;

type CommentWithRelations = Prisma.CommentGetPayload<{ include: typeof commentInclude }>;

function toItem(comment: CommentWithRelations, replies: CommentData[] = []): CommentData {
  return {
    id: comment.id,
    organizationId: comment.organizationId,
    entityType: comment.entityType,
    entityId: comment.entityId,
    authorId: comment.authorId,
    parentCommentId: comment.parentCommentId,
    content: comment.content,
    resolved: comment.resolved,
    resolvedBy: toUserSummaryOrNull(comment.resolvedBy),
    resolvedAt: comment.resolvedAt,
    author: toUserSummaryOrNull(comment.author) as UserSummary,
    attachments: comment.attachments,
    replies,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

export interface CreateCommentData {
  organizationId: string;
  entityType: CommentableEntityType;
  entityId: string;
  authorId: string;
  parentCommentId?: string | null;
  content: string;
}

export async function createComment(data: CreateCommentData): Promise<CommentData> {
  const created = await prisma.comment.create({ data, include: commentInclude });
  return toItem(created);
}

export async function getCommentById(id: string, organizationId: string): Promise<CommentData | null> {
  const comment = await prisma.comment.findFirst({ where: { id, organizationId }, include: commentInclude });
  return comment ? toItem(comment) : null;
}

export interface ListCommentsForEntityFilters {
  organizationId: string;
  entityType: CommentableEntityType;
  entityId: string;
  page: number;
  pageSize: number;
}

/** Paginates ROOT comments (`parentCommentId: null`); every root's full reply chain is eagerly attached, unpaginated — the typical thread has few replies, and this avoids a second round of pagination UI for replies. */
export async function listCommentsForEntity(filters: ListCommentsForEntityFilters): Promise<PaginatedResult<CommentData>> {
  const { organizationId, entityType, entityId, page, pageSize } = filters;
  const where: Prisma.CommentWhereInput = { organizationId, entityType, entityId, parentCommentId: null };

  const [roots, total] = await Promise.all([
    prisma.comment.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: commentInclude,
    }),
    prisma.comment.count({ where }),
  ]);

  const replies = roots.length
    ? await prisma.comment.findMany({
        where: { organizationId, parentCommentId: { in: roots.map((root) => root.id) } },
        orderBy: { createdAt: 'asc' },
        include: commentInclude,
      })
    : [];

  const repliesByParent = new Map<string, CommentData[]>();
  for (const reply of replies) {
    const parentId = reply.parentCommentId as string;
    const list = repliesByParent.get(parentId) ?? [];
    list.push(toItem(reply));
    repliesByParent.set(parentId, list);
  }

  return {
    items: roots.map((root) => toItem(root, repliesByParent.get(root.id) ?? [])),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function updateCommentContent(id: string, organizationId: string, content: string): Promise<CommentData | null> {
  const result = await prisma.comment.updateMany({ where: { id, organizationId }, data: { content } });
  if (result.count === 0) return null;
  return getCommentById(id, organizationId);
}

export async function resolveComment(id: string, organizationId: string, resolvedById: string): Promise<CommentData | null> {
  const result = await prisma.comment.updateMany({
    where: { id, organizationId },
    data: { resolved: true, resolvedById, resolvedAt: new Date() },
  });
  if (result.count === 0) return null;
  return getCommentById(id, organizationId);
}

export async function unresolveComment(id: string, organizationId: string): Promise<CommentData | null> {
  const result = await prisma.comment.updateMany({
    where: { id, organizationId },
    data: { resolved: false, resolvedById: null, resolvedAt: null },
  });
  if (result.count === 0) return null;
  return getCommentById(id, organizationId);
}

export async function deleteComment(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.comment.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}

/** Wired additively into every relevant delete service (task/project/meeting/document/customer/entity) so a hard-deleted entity doesn't leave an orphaned, still-linked comment thread — unlike `Embedding`'s own unaddressed orphan gap. */
export async function deleteCommentsForEntity(
  organizationId: string,
  entityType: CommentableEntityType,
  entityId: string,
): Promise<number> {
  const result = await prisma.comment.deleteMany({ where: { organizationId, entityType, entityId } });
  return result.count;
}

export interface CreateCommentAttachmentData {
  commentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  storagePath: string;
}

export async function createCommentAttachment(data: CreateCommentAttachmentData): Promise<CommentAttachmentData> {
  return prisma.commentAttachment.create({ data });
}

export async function deleteCommentAttachment(id: string, commentId: string): Promise<boolean> {
  const result = await prisma.commentAttachment.deleteMany({ where: { id, commentId } });
  return result.count > 0;
}
