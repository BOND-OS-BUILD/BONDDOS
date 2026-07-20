import { requireRole } from '@bond-os/auth';
import {
  archiveConversationsOlderThan,
  areAllUsersInOrganization,
  createConversation as createConversationRow,
  deleteConversation as deleteConversationRow,
  getConversationById,
  getConversationShareForUser,
  listConversations,
  listConversationsSharedWithUser,
  listSharesForConversation,
  removeConversationShare as removeConversationShareRow,
  transferConversationOwnership,
  updateConversation as updateConversationRow,
  upsertConversationShare,
  type ConversationListItem,
  type ConversationShareData,
  type SharedConversationSummary,
} from '@bond-os/database';
import {
  ForbiddenError,
  NotFoundError,
  ROLES,
  roleSatisfies,
  ValidationError,
  type ConversationQuery,
  type CreateConversationInput,
  type PaginatedResult,
  type Role,
  type ShareConversationInput,
  type UpdateConversationInput,
} from '@bond-os/shared';
import { getEnv } from '@bond-os/shared/server';

/** Plain CRUD over `Conversation` — the chat thread list/rename/pin/archive/delete surface (spec §9). */

/**
 * Default-private `Conversation` access (Phase 9). Before this existed,
 * `Conversation` had NO ownership gate at all — `createdById` was stored
 * but only ever used as an optional list filter, any org MEMBER could
 * already read/rename/delete any other member's conversation by id. This is
 * a real, intentional behavior change, not a bug fix for a regression.
 *
 * A conversation with no recorded `createdBy` (legacy/system rows predating
 * this check, or created with no `createdById`) is left unrestricted —
 * there is no owner to gate against, so this only ever narrows access for
 * conversations that actually have one.
 *
 * `'read'` — view the conversation/messages: owner, ADMIN+, or any share.
 * `'collaborate'` — post new messages: owner, ADMIN+, or a COLLABORATE
 * share specifically (a READ share cannot write).
 * `'manage'` — rename/pin/archive/delete: owner or ADMIN+ only; no share
 * grants this — sharing is about content access, not conversation lifecycle.
 */
export type ConversationAccessLevel = 'read' | 'collaborate' | 'manage';

export async function assertConversationAccess(
  conversation: ConversationListItem,
  callerId: string,
  callerRole: Role,
  level: ConversationAccessLevel,
): Promise<void> {
  if (!conversation.createdBy) return;
  if (conversation.createdBy.id === callerId) return;
  if (roleSatisfies(callerRole, ROLES.ADMIN)) return;

  if (level === 'manage') {
    throw new ForbiddenError('Only the conversation owner can manage this conversation.');
  }

  const share = await getConversationShareForUser(conversation.id, callerId);
  if (!share) throw new ForbiddenError('You do not have access to this conversation.');
  if (level === 'collaborate' && share.permission !== 'COLLABORATE') {
    throw new ForbiddenError('You have read-only access to this conversation.');
  }
}

export async function listConversationsService(
  organizationId: string,
  userId: string,
  query: ConversationQuery,
): Promise<PaginatedResult<ConversationListItem>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listConversations({ organizationId, userId, ...query });
}

export async function getConversationService(organizationId: string, id: string): Promise<ConversationListItem> {
  const { session, membership } = await requireRole(organizationId, ROLES.MEMBER);
  const conversation = await getConversationById(id, organizationId);
  if (!conversation) throw new NotFoundError('Conversation not found.');
  await assertConversationAccess(conversation, session.user.id, membership.role, 'read');
  return conversation;
}

export async function createConversationService(
  organizationId: string,
  userId: string,
  input: CreateConversationInput,
): Promise<ConversationListItem> {
  await requireRole(organizationId, ROLES.MEMBER);
  const created = await createConversationRow({ organizationId, createdById: userId, title: input.title });
  return { ...created, createdBy: null, messageCount: 0, lastMessageAt: null };
}

export async function updateConversationService(
  organizationId: string,
  id: string,
  input: UpdateConversationInput,
): Promise<ConversationListItem> {
  const { session, membership } = await requireRole(organizationId, ROLES.MEMBER);
  const conversation = await getConversationById(id, organizationId);
  if (!conversation) throw new NotFoundError('Conversation not found.');
  await assertConversationAccess(conversation, session.user.id, membership.role, 'manage');

  const updated = await updateConversationRow(id, organizationId, input);
  if (!updated) throw new NotFoundError('Conversation not found.');
  return getConversationService(organizationId, id);
}

export async function deleteConversationService(organizationId: string, id: string): Promise<void> {
  const { session, membership } = await requireRole(organizationId, ROLES.MEMBER);
  const conversation = await getConversationById(id, organizationId);
  if (!conversation) throw new NotFoundError('Conversation not found.');
  await assertConversationAccess(conversation, session.user.id, membership.role, 'manage');

  const deleted = await deleteConversationRow(id, organizationId);
  if (!deleted) throw new NotFoundError('Conversation not found.');
}

/** The manual "Archive old conversations" admin action (spec §5's memory expiration) — no background worker, same honesty as Phase 2/4's sync/embedding jobs. */
export async function archiveOldConversationsService(organizationId: string, olderThanDays?: number): Promise<number> {
  await requireRole(organizationId, ROLES.ADMIN);
  const days = olderThanDays ?? getEnv().MEMORY_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return archiveConversationsOlderThan(organizationId, cutoff);
}

/** Sharing is a `manage`-level action — only the owner or an org ADMIN+ decides who else gets access, mirroring rename/delete. See docs/shared-ai.md. */
export async function shareConversationService(
  organizationId: string,
  conversationId: string,
  input: ShareConversationInput,
): Promise<ConversationShareData> {
  const { session, membership } = await requireRole(organizationId, ROLES.MEMBER);
  const conversation = await getConversationById(conversationId, organizationId);
  if (!conversation) throw new NotFoundError('Conversation not found.');
  await assertConversationAccess(conversation, session.user.id, membership.role, 'manage');

  if (input.sharedWithUserId === conversation.createdBy?.id) {
    throw new ValidationError('This conversation is already owned by that user.');
  }
  if (!(await areAllUsersInOrganization([input.sharedWithUserId], organizationId))) {
    throw new ValidationError('You can only share with members of your organization.');
  }

  return upsertConversationShare({
    organizationId,
    conversationId,
    sharedWithUserId: input.sharedWithUserId,
    permission: input.permission,
    sharedById: session.user.id,
  });
}

export async function listConversationSharesService(organizationId: string, conversationId: string): Promise<ConversationShareData[]> {
  const { session, membership } = await requireRole(organizationId, ROLES.MEMBER);
  const conversation = await getConversationById(conversationId, organizationId);
  if (!conversation) throw new NotFoundError('Conversation not found.');
  await assertConversationAccess(conversation, session.user.id, membership.role, 'manage');

  return listSharesForConversation(conversationId, organizationId);
}

export async function removeConversationShareService(organizationId: string, conversationId: string, sharedWithUserId: string): Promise<void> {
  const { session, membership } = await requireRole(organizationId, ROLES.MEMBER);
  const conversation = await getConversationById(conversationId, organizationId);
  if (!conversation) throw new NotFoundError('Conversation not found.');
  await assertConversationAccess(conversation, session.user.id, membership.role, 'manage');

  const removed = await removeConversationShareRow(conversationId, organizationId, sharedWithUserId);
  if (!removed) throw new NotFoundError('This conversation is not shared with that user.');
}

/** Reassigns `Conversation.createdById` — the one way a non-owner can gain `manage` access, since no share ever grants it. */
export async function transferConversationOwnershipService(organizationId: string, conversationId: string, newOwnerId: string): Promise<ConversationListItem> {
  const { session, membership } = await requireRole(organizationId, ROLES.MEMBER);
  const conversation = await getConversationById(conversationId, organizationId);
  if (!conversation) throw new NotFoundError('Conversation not found.');
  await assertConversationAccess(conversation, session.user.id, membership.role, 'manage');

  if (!(await areAllUsersInOrganization([newOwnerId], organizationId))) {
    throw new ValidationError('The new owner must be a member of your organization.');
  }

  const transferred = await transferConversationOwnership(conversationId, organizationId, newOwnerId);
  if (!transferred) throw new NotFoundError('Conversation not found.');
  return getConversationService(organizationId, conversationId);
}

export async function listConversationsSharedWithMeService(
  organizationId: string,
  userId: string,
  page: number,
  pageSize: number,
): Promise<PaginatedResult<SharedConversationSummary>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listConversationsSharedWithUser(organizationId, userId, page, pageSize);
}
