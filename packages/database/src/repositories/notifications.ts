import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { NotificationType, Prisma } from '../generated/index.js';

/**
 * The unified notification model (Phase 9) — fanned out from `publishEvent()`
 * (see `notification-fanout.service.ts`) plus direct creation for mentions.
 * Read/unread, archive, and snooze are plain columns on one mutable row,
 * mirroring `ApprovalRequest`'s own "single row, org-scoped `updateMany` for
 * every state transition" shape. See docs/notifications.md.
 */

export interface NotificationData {
  id: string;
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  sourceEventId: string | null;
  read: boolean;
  readAt: Date | null;
  archived: boolean;
  snoozedUntil: Date | null;
  createdAt: Date;
}

export interface NotificationInput {
  organizationId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  sourceEventId?: string | null;
}

/** The primary write path — always batched. A single `Event` can fan out to many recipients (project members, mentioned users); this is one `createMany`, never N sequential `create` calls. */
export async function createNotifications(notifications: NotificationInput[]): Promise<number> {
  if (notifications.length === 0) return 0;
  const result = await prisma.notification.createMany({ data: notifications });
  return result.count;
}

export interface ListNotificationsForUserFilters {
  organizationId: string;
  userId: string;
  page: number;
  pageSize: number;
  read?: boolean;
  archived?: boolean;
  types?: NotificationType[];
  /** Inbox category groupings (Assigned/Mentions/Approvals/AI Insights/Workflow Events/Activity) are just curated `types` arrays at the service layer — this repository stays category-agnostic. */
}

/** Excludes currently-snoozed rows (`snoozedUntil` in the future) by default — a snoozed notification reappears on its own once `snoozedUntil` passes, with no worker needed, the same "checked on access" idiom `expireStaleApprovalRequests` uses. */
export async function listNotificationsForUser(filters: ListNotificationsForUserFilters): Promise<PaginatedResult<NotificationData>> {
  const { organizationId, userId, page, pageSize, read, archived, types } = filters;

  const where: Prisma.NotificationWhereInput = {
    organizationId,
    userId,
    ...(read !== undefined && { read }),
    ...(archived !== undefined && { archived }),
    ...(types && types.length > 0 && { type: { in: types } }),
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
  };

  const [items, total] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.notification.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getUnreadNotificationCount(organizationId: string, userId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      organizationId,
      userId,
      read: false,
      archived: false,
      OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: new Date() } }],
    },
  });
}

export async function markNotificationRead(id: string, organizationId: string, userId: string): Promise<boolean> {
  const result = await prisma.notification.updateMany({
    where: { id, organizationId, userId },
    data: { read: true, readAt: new Date() },
  });
  return result.count > 0;
}

export async function markAllNotificationsRead(organizationId: string, userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { organizationId, userId, read: false },
    data: { read: true, readAt: new Date() },
  });
  return result.count;
}

export async function archiveNotification(id: string, organizationId: string, userId: string): Promise<boolean> {
  const result = await prisma.notification.updateMany({ where: { id, organizationId, userId }, data: { archived: true } });
  return result.count > 0;
}

export async function snoozeNotification(
  id: string,
  organizationId: string,
  userId: string,
  snoozedUntil: Date,
): Promise<boolean> {
  const result = await prisma.notification.updateMany({ where: { id, organizationId, userId }, data: { snoozedUntil } });
  return result.count > 0;
}
