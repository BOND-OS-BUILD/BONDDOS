import { ConflictError, type PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { Prisma } from '../generated/index.js';
import { toUserSummary, userSummarySelect, type UserSummary } from './shared';

export interface MeetingListFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  search?: string;
  sortBy: 'title' | 'meetingDate' | 'createdAt';
  sortDir: 'asc' | 'desc';
  projectId?: string;
}

export interface MeetingListItem {
  id: string;
  title: string;
  agenda: string | null;
  location: string | null;
  meetingDate: Date;
  duration: number | null;
  project: { id: string; title: string };
  attendeeCount: number;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MeetingDetail extends MeetingListItem {
  notes: string | null;
  organizationId: string;
  attendees: UserSummary[];
  documents: Array<{ id: string; title: string; type: string; fileName: string; createdAt: Date }>;
}

const listInclude = {
  project: { select: { id: true, title: true } },
  _count: { select: { attendees: true, documents: true } },
} satisfies Prisma.MeetingInclude;

type MeetingWithCounts = Prisma.MeetingGetPayload<{ include: typeof listInclude }>;

function toListItem(meeting: MeetingWithCounts): MeetingListItem {
  return {
    id: meeting.id,
    title: meeting.title,
    agenda: meeting.agenda,
    location: meeting.location,
    meetingDate: meeting.meetingDate,
    duration: meeting.duration,
    project: meeting.project,
    attendeeCount: meeting._count.attendees,
    documentCount: meeting._count.documents,
    createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt,
  };
}

export async function listMeetings(filters: MeetingListFilters): Promise<PaginatedResult<MeetingListItem>> {
  const { organizationId, page, pageSize, search, sortBy, sortDir, projectId } = filters;

  const where: Prisma.MeetingWhereInput = {
    organizationId,
    ...(projectId && { projectId }),
    ...(search && { title: { contains: search, mode: 'insensitive' } }),
  };

  const [items, total] = await Promise.all([
    prisma.meeting.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: listInclude,
    }),
    prisma.meeting.count({ where }),
  ]);

  return {
    items: items.map(toListItem),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getMeetingById(id: string, organizationId: string): Promise<MeetingDetail | null> {
  const meeting = await prisma.meeting.findFirst({
    where: { id, organizationId },
    include: {
      ...listInclude,
      attendees: { include: { user: { select: userSummarySelect } } },
      documents: {
        select: { id: true, title: true, type: true, fileName: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!meeting) return null;

  return {
    ...toListItem(meeting),
    notes: meeting.notes,
    organizationId: meeting.organizationId,
    attendees: meeting.attendees.map((attendee) => toUserSummary(attendee.user)),
    documents: meeting.documents,
  };
}

export interface CreateMeetingData {
  organizationId: string;
  title: string;
  agenda?: string | null;
  notes?: string | null;
  location?: string | null;
  meetingDate: Date;
  duration?: number | null;
  projectId: string;
  attendeeIds: string[];
}

export async function createMeeting(data: CreateMeetingData): Promise<MeetingDetail> {
  const { attendeeIds, ...rest } = data;

  const meeting = await prisma.meeting.create({
    data: {
      ...rest,
      attendees: { create: attendeeIds.map((userId) => ({ userId })) },
    },
  });

  const detail = await getMeetingById(meeting.id, meeting.organizationId);
  if (!detail) throw new Error('Failed to load meeting immediately after creation.');
  return detail;
}

export interface UpdateMeetingData {
  title?: string;
  agenda?: string | null;
  notes?: string | null;
  location?: string | null;
  meetingDate?: Date;
  duration?: number | null;
  projectId?: string;
  attendeeIds?: string[];
  /** Optimistic-locking guard (Phase 9 Shared Editing) — omitted by every pre-Phase-9 caller, preserving last-write-wins for them; only adds a `version` predicate to the update when provided. Throws `ConflictError` on a stale/lost race. */
  expectedVersion?: number;
  /** Attributed on the `EntityVersionSnapshot` row written before every update, regardless of whether `expectedVersion` was passed. */
  editedById?: string | null;
}

/**
 * Updates a meeting, scoped to `organizationId` via `updateMany` (Prisma's
 * unique-`update` can't combine `id` with a non-unique `organizationId`
 * filter). Attendee replacement only runs if the scoped update actually
 * matched a row, so a cross-tenant `id` can't sneak an attendee-list
 * mutation through even though the field update itself was a no-op.
 *
 * Phase 9 additive: every update snapshots the pre-overwrite row into
 * `EntityVersionSnapshot` and increments `version` — see docs/collaboration.md.
 */
export async function updateMeeting(
  id: string,
  organizationId: string,
  data: UpdateMeetingData,
): Promise<MeetingDetail | null> {
  const { attendeeIds, expectedVersion, editedById, ...rest } = data;

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.meeting.findFirst({ where: { id, organizationId } });
    if (!current) return false;

    if (expectedVersion !== undefined && current.version !== expectedVersion) {
      throw new ConflictError('This meeting was edited by someone else. Refresh and try again.');
    }

    await tx.entityVersionSnapshot.create({
      data: {
        organizationId,
        entityType: 'MEETING',
        entityId: id,
        version: current.version,
        snapshot: current as unknown as Prisma.InputJsonValue,
        editedById: editedById ?? null,
      },
    });

    const versionGuard = expectedVersion !== undefined ? { version: current.version } : {};
    const result = await tx.meeting.updateMany({
      where: { id, organizationId, ...versionGuard },
      data: { ...rest, version: { increment: 1 } },
    });
    if (result.count === 0) {
      throw new ConflictError('This meeting was edited by someone else. Refresh and try again.');
    }

    if (attendeeIds) {
      await tx.meetingAttendee.deleteMany({ where: { meetingId: id } });
      if (attendeeIds.length > 0) {
        await tx.meetingAttendee.createMany({
          data: attendeeIds.map((userId) => ({ meetingId: id, userId })),
          skipDuplicates: true,
        });
      }
    }

    return true;
  });

  if (!updated) return null;
  return getMeetingById(id, organizationId);
}

export async function deleteMeeting(id: string, organizationId: string): Promise<boolean> {
  const result = await prisma.meeting.deleteMany({ where: { id, organizationId } });
  return result.count > 0;
}
