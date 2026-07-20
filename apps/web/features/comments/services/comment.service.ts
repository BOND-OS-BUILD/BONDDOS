import { requireRole } from '@bond-os/auth';
import {
  areAllSpacesInOrganization,
  areAllUsersInOrganization,
  createComment as createCommentRow,
  createCommentAttachment as createCommentAttachmentRow,
  createMentions,
  deleteComment as deleteCommentRow,
  getCommentById,
  getCustomerById,
  getDocumentById,
  getEntityNode,
  getMeetingById,
  getProjectById,
  getTaskById,
  listCommentsForEntity,
  resolveComment as resolveCommentRow,
  unresolveComment as unresolveCommentRow,
  updateCommentContent,
  type CommentableEntityType,
  type CommentAttachmentData,
  type CommentData,
} from '@bond-os/database';
import {
  ForbiddenError,
  NotFoundError,
  ROLES,
  roleSatisfies,
  ValidationError,
  type CreateCommentInput,
  type PaginatedResult,
} from '@bond-os/shared';

import { uploadPublicFile } from '@/lib/supabase';

import { parseMentions } from '../lib/mention-parser';

/**
 * Universal comments (Phase 9) — attach to Projects/Tasks/Meetings/
 * Documents/Customers/Graph nodes. `entityType`/`entityId` are loosely
 * typed (no hard FK) at the schema layer, so `assertEntityExists` below is
 * the app-level check that stands in for one. See docs/comments.md.
 */

/** Dynamically imported — mirrors every other curated `publishEvent()` call site (docs/event-bus.md), kept consistent even though this file isn't currently on the Tool Registry's import chain. */
async function getPublishEvent() {
  const { publishEvent } = await import('@/features/workflows/services/event-bus.service');
  return publishEvent;
}

/** Dynamically imported for the same reason: `agents/registry.ts` is a "bootstrap file that imports every concrete implementation" analogous to the Tool Registry, so this stays consistent with the defensive pattern even without a proven cycle today. */
async function getAgentRegistryService() {
  const { getAgentRegistryService } = await import('@/features/agents/lib/container');
  return getAgentRegistryService();
}

async function assertEntityExists(organizationId: string, entityType: CommentableEntityType, entityId: string): Promise<void> {
  const exists = await (async () => {
    switch (entityType) {
      case 'PROJECT':
        return (await getProjectById(entityId, organizationId)) !== null;
      case 'TASK':
        return (await getTaskById(entityId, organizationId)) !== null;
      case 'MEETING':
        return (await getMeetingById(entityId, organizationId)) !== null;
      case 'DOCUMENT':
        return (await getDocumentById(entityId, organizationId)) !== null;
      case 'CUSTOMER':
        return (await getCustomerById(entityId, organizationId)) !== null;
      case 'GRAPH_NODE':
        return (await getEntityNode(entityId, organizationId)) !== null;
      default:
        return false;
    }
  })();
  if (!exists) throw new NotFoundError(`${entityType.toLowerCase().replace('_', ' ')} not found.`);
}

export async function listCommentsForEntityService(
  organizationId: string,
  entityType: CommentableEntityType,
  entityId: string,
  page: number,
  pageSize: number,
): Promise<PaginatedResult<CommentData>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listCommentsForEntity({ organizationId, entityType, entityId, page, pageSize });
}

export async function createCommentService(organizationId: string, callerId: string, input: CreateCommentInput): Promise<CommentData> {
  await requireRole(organizationId, ROLES.MEMBER);
  await assertEntityExists(organizationId, input.entityType, input.entityId);

  if (input.parentCommentId) {
    const parent = await getCommentById(input.parentCommentId, organizationId);
    if (!parent) throw new NotFoundError('Parent comment not found.');
    if (parent.entityType !== input.entityType || parent.entityId !== input.entityId) {
      throw new ValidationError('A reply must target the same entity as its parent comment.');
    }
  }

  const mentions = parseMentions(input.content);
  const userMentionIds = mentions.filter((mention) => mention.type === 'USER').map((mention) => mention.targetId);
  const spaceMentionIds = mentions.filter((mention) => mention.type === 'SPACE').map((mention) => mention.targetId);
  const agentMentions = mentions.filter((mention) => mention.type === 'AGENT');

  if (userMentionIds.length > 0 && !(await areAllUsersInOrganization(userMentionIds, organizationId))) {
    throw new ValidationError('You can only mention members of your organization.');
  }
  if (spaceMentionIds.length > 0 && !(await areAllSpacesInOrganization(spaceMentionIds, organizationId))) {
    throw new ValidationError('You can only mention spaces in your organization.');
  }
  if (agentMentions.length > 0) {
    const registry = await getAgentRegistryService();
    for (const agentMention of agentMentions) {
      if (!registry.get(agentMention.targetId)) {
        throw new ValidationError(`Unknown agent: ${agentMention.targetId}`);
      }
    }
  }

  const comment = await createCommentRow({
    organizationId,
    entityType: input.entityType,
    entityId: input.entityId,
    authorId: callerId,
    parentCommentId: input.parentCommentId,
    content: input.content,
  });

  if (mentions.length > 0) {
    await createMentions(
      mentions.map((mention) => ({
        organizationId,
        commentId: comment.id,
        mentionedType: mention.type,
        mentionedUserId: mention.type === 'USER' ? mention.targetId : undefined,
        mentionedSpaceId: mention.type === 'SPACE' ? mention.targetId : undefined,
        mentionedAgentKey: mention.type === 'AGENT' ? mention.targetId : undefined,
      })),
    );
  }

  const publishEvent = await getPublishEvent();
  await publishEvent({
    organizationId,
    eventType: 'comment.created',
    source: 'COLLABORATION',
    payload: {
      commentId: comment.id,
      entityType: input.entityType,
      entityId: input.entityId,
      authorId: callerId,
      mentionedUserIds: userMentionIds,
      snippet: input.content.length > 140 ? `${input.content.slice(0, 140)}…` : input.content,
    },
    entityType: input.entityType,
    entityId: input.entityId,
  });

  return comment;
}

export async function updateCommentService(organizationId: string, callerId: string, id: string, content: string): Promise<CommentData> {
  await requireRole(organizationId, ROLES.MEMBER);
  const comment = await getCommentById(id, organizationId);
  if (!comment) throw new NotFoundError('Comment not found.');
  if (comment.authorId !== callerId) throw new ForbiddenError('Only the author can edit this comment.');

  const updated = await updateCommentContent(id, organizationId, content);
  if (!updated) throw new NotFoundError('Comment not found.');
  return updated;
}

export async function resolveCommentService(organizationId: string, callerId: string, id: string): Promise<CommentData> {
  await requireRole(organizationId, ROLES.MEMBER);
  const updated = await resolveCommentRow(id, organizationId, callerId);
  if (!updated) throw new NotFoundError('Comment not found.');
  return updated;
}

export async function unresolveCommentService(organizationId: string, id: string): Promise<CommentData> {
  await requireRole(organizationId, ROLES.MEMBER);
  const updated = await unresolveCommentRow(id, organizationId);
  if (!updated) throw new NotFoundError('Comment not found.');
  return updated;
}

export async function deleteCommentService(organizationId: string, callerId: string, id: string): Promise<void> {
  const { membership } = await requireRole(organizationId, ROLES.MEMBER);
  const comment = await getCommentById(id, organizationId);
  if (!comment) throw new NotFoundError('Comment not found.');

  const isAuthor = comment.authorId === callerId;
  const isModerator = roleSatisfies(membership.role, ROLES.ADMIN);
  if (!isAuthor && !isModerator) {
    throw new ForbiddenError('Only the author or an organization admin can delete this comment.');
  }

  const deleted = await deleteCommentRow(id, organizationId);
  if (!deleted) throw new NotFoundError('Comment not found.');
}

const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(dot) : '';
}

export async function addCommentAttachmentService(
  organizationId: string,
  callerId: string,
  commentId: string,
  file: Blob & { name: string; type: string; size: number },
): Promise<CommentAttachmentData> {
  await requireRole(organizationId, ROLES.MEMBER);
  const comment = await getCommentById(commentId, organizationId);
  if (!comment) throw new NotFoundError('Comment not found.');
  if (comment.authorId !== callerId) throw new ForbiddenError('Only the author can attach files to this comment.');
  if (file.size > MAX_ATTACHMENT_SIZE) throw new ValidationError('Attachment must be smaller than 20MB.');

  const filename = `${crypto.randomUUID()}${extensionOf(file.name)}`;
  const uploaded = await uploadPublicFile('comments', filename, file);

  return createCommentAttachmentRow({
    commentId,
    fileName: file.name,
    mimeType: file.type,
    size: file.size,
    storagePath: uploaded.path,
  });
}
