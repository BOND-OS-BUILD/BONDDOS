import { requireRole } from '@bond-os/auth';
import {
  archiveNotification as archiveNotificationRow,
  getUnreadNotificationCount,
  listNotificationsForUser,
  markAllNotificationsRead as markAllNotificationsReadRow,
  markNotificationRead as markNotificationReadRow,
  snoozeNotification as snoozeNotificationRow,
  type NotificationData,
  type NotificationType,
} from '@bond-os/database';
import { NotFoundError, ROLES, type NotificationCategory, type PaginatedResult } from '@bond-os/shared';

/**
 * The read/manage half of Notifications (Phase 9) — `notification-fanout.service.ts`
 * is the write half. Inbox categories are just curated `NotificationType`
 * groupings resolved here; the repository stays category-agnostic. See
 * docs/notifications.md.
 */

const CATEGORY_TYPES: Record<NotificationCategory, NotificationType[]> = {
  assigned: ['TASK_ASSIGNMENT'],
  mentions: ['MENTION'],
  approvals: ['APPROVAL_REQUEST'],
  ai_insights: ['AGENT_INSIGHT'],
  workflow_events: ['WORKFLOW_EVENT'],
  activity: ['PROJECT_UPDATE', 'MEETING_REMINDER', 'COMMENT', 'SYSTEM'],
};

export interface ListNotificationsFilters {
  page: number;
  pageSize: number;
  read?: boolean;
  archived?: boolean;
  category?: NotificationCategory;
}

export async function listNotificationsService(
  organizationId: string,
  userId: string,
  filters: ListNotificationsFilters,
): Promise<PaginatedResult<NotificationData>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listNotificationsForUser({
    organizationId,
    userId,
    page: filters.page,
    pageSize: filters.pageSize,
    read: filters.read,
    archived: filters.archived,
    types: filters.category ? CATEGORY_TYPES[filters.category] : undefined,
  });
}

export async function getUnreadNotificationCountService(organizationId: string, userId: string): Promise<number> {
  await requireRole(organizationId, ROLES.MEMBER);
  return getUnreadNotificationCount(organizationId, userId);
}

/** The Inbox's 6-category badge-count summary — each count reuses `listNotificationsForUser`'s own `WHERE`-scoped `count()` (via `.total`), never a full row fetch, so this stays cheap even with a large notification history. */
export async function getInboxSummaryService(organizationId: string, userId: string): Promise<Record<NotificationCategory, number>> {
  await requireRole(organizationId, ROLES.MEMBER);
  const categories = Object.keys(CATEGORY_TYPES) as NotificationCategory[];
  const counts = await Promise.all(
    categories.map((category) =>
      listNotificationsForUser({ organizationId, userId, page: 1, pageSize: 1, read: false, types: CATEGORY_TYPES[category] }).then(
        (result) => result.total,
      ),
    ),
  );
  return Object.fromEntries(categories.map((category, index) => [category, counts[index]])) as Record<NotificationCategory, number>;
}

export async function markNotificationReadService(organizationId: string, userId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.MEMBER);
  const updated = await markNotificationReadRow(id, organizationId, userId);
  if (!updated) throw new NotFoundError('Notification not found.');
}

export async function markAllNotificationsReadService(organizationId: string, userId: string): Promise<number> {
  await requireRole(organizationId, ROLES.MEMBER);
  return markAllNotificationsReadRow(organizationId, userId);
}

export async function archiveNotificationService(organizationId: string, userId: string, id: string): Promise<void> {
  await requireRole(organizationId, ROLES.MEMBER);
  const updated = await archiveNotificationRow(id, organizationId, userId);
  if (!updated) throw new NotFoundError('Notification not found.');
}

export async function snoozeNotificationService(organizationId: string, userId: string, id: string, snoozedUntil: Date): Promise<void> {
  await requireRole(organizationId, ROLES.MEMBER);
  const updated = await snoozeNotificationRow(id, organizationId, userId, snoozedUntil);
  if (!updated) throw new NotFoundError('Notification not found.');
}
