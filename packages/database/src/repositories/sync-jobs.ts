import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { ConnectorProvider, SyncJobStatus, SyncTrigger } from '../generated/index.js';

export interface SyncJobSummary {
  id: string;
  connectorId: string;
  connectorProvider: ConnectorProvider;
  status: SyncJobStatus;
  trigger: SyncTrigger;
  startedAt: Date;
  completedAt: Date | null;
  itemsProcessed: number;
  itemsFailed: number;
  errorMessage: string | null;
  retryCount: number;
}

export interface SyncJobListFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  connectorId?: string;
}

export async function listSyncJobs(filters: SyncJobListFilters): Promise<PaginatedResult<SyncJobSummary>> {
  const { organizationId, page, pageSize, connectorId } = filters;
  const where = { organizationId, ...(connectorId && { connectorId }) };

  const [items, total] = await Promise.all([
    prisma.syncJob.findMany({
      where,
      include: { connector: { select: { provider: true } } },
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.syncJob.count({ where }),
  ]);

  return {
    items: items.map((job) => ({
      id: job.id,
      connectorId: job.connectorId,
      connectorProvider: job.connector.provider,
      status: job.status,
      trigger: job.trigger,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      itemsProcessed: job.itemsProcessed,
      itemsFailed: job.itemsFailed,
      errorMessage: job.errorMessage,
      retryCount: job.retryCount,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface CreateSyncJobData {
  organizationId: string;
  connectorId: string;
  trigger: SyncTrigger;
}

export function createSyncJob(data: CreateSyncJobData) {
  return prisma.syncJob.create({ data: { ...data, status: 'RUNNING' } });
}

export interface CompleteSyncJobData {
  status: Extract<SyncJobStatus, 'SUCCEEDED' | 'FAILED' | 'RETRYING'>;
  itemsProcessed: number;
  itemsFailed: number;
  errorMessage?: string | null;
}

export async function completeSyncJob(id: string, organizationId: string, data: CompleteSyncJobData): Promise<void> {
  await prisma.syncJob.updateMany({
    where: { id, organizationId },
    data: { ...data, completedAt: new Date() },
  });
}
