import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { Prisma } from '../generated/index.js';

/**
 * Shared Editing's version history (Phase 9) — ONE polymorphic table
 * (mirrors `Event`/`AuditEvent`'s own "one table, not N duplicated ones"
 * precedent), covering Document/Project/Meeting/`Entity` version history. A
 * snapshot is written BEFORE every versioned overwrite, so `version`'s full
 * prior state is always recoverable — see the versioned `update*Service`
 * functions that call this. See docs/collaboration.md.
 */

export interface EntityVersionSnapshotData {
  id: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  version: number;
  snapshot: unknown;
  editedById: string | null;
  createdAt: Date;
}

export interface CreateEntityVersionSnapshotData {
  organizationId: string;
  entityType: string;
  entityId: string;
  version: number;
  snapshot: Prisma.InputJsonValue;
  editedById?: string | null;
}

export async function createEntityVersionSnapshot(data: CreateEntityVersionSnapshotData): Promise<EntityVersionSnapshotData> {
  return prisma.entityVersionSnapshot.create({ data });
}

export interface ListEntityVersionSnapshotsFilters {
  organizationId: string;
  entityType: string;
  entityId: string;
  page: number;
  pageSize: number;
}

export async function listEntityVersionSnapshots(filters: ListEntityVersionSnapshotsFilters): Promise<PaginatedResult<EntityVersionSnapshotData>> {
  const { organizationId, entityType, entityId, page, pageSize } = filters;
  const where: Prisma.EntityVersionSnapshotWhereInput = { organizationId, entityType, entityId };

  const [items, total] = await Promise.all([
    prisma.entityVersionSnapshot.findMany({
      where,
      orderBy: { version: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.entityVersionSnapshot.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getEntityVersionSnapshot(
  organizationId: string,
  entityType: string,
  entityId: string,
  version: number,
): Promise<EntityVersionSnapshotData | null> {
  return prisma.entityVersionSnapshot.findFirst({ where: { organizationId, entityType, entityId, version } });
}
