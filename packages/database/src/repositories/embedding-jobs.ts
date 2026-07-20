import type { PaginatedResult } from '@bond-os/shared';

import { prisma } from '../client';
import type { EmbeddingJobStatus, EmbeddingJobType, EmbeddingSourceType } from '../generated/index.js';

/** Mirrors `sync-jobs.ts`'s shape exactly — one row per attempt, retryable, no real worker behind it yet. See docs/embeddings.md. */

export interface EmbeddingJobSummary {
  id: string;
  jobType: EmbeddingJobType;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  status: EmbeddingJobStatus;
  provider: string | null;
  errorMessage: string | null;
  retryCount: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface EmbeddingJobListFilters {
  organizationId: string;
  page: number;
  pageSize: number;
  status?: EmbeddingJobStatus;
}

export async function listEmbeddingJobs(filters: EmbeddingJobListFilters): Promise<PaginatedResult<EmbeddingJobSummary>> {
  const { organizationId, page, pageSize, status } = filters;
  const where = { organizationId, ...(status && { status }) };

  const [items, total] = await Promise.all([
    prisma.embeddingJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.embeddingJob.count({ where }),
  ]);

  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function listFailedEmbeddingJobs(organizationId: string, limit = 50): Promise<EmbeddingJobSummary[]> {
  return prisma.embeddingJob.findMany({
    where: { organizationId, status: 'FAILED' },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export interface CreateEmbeddingJobData {
  organizationId: string;
  jobType: EmbeddingJobType;
  sourceType: EmbeddingSourceType;
  sourceId: string;
  provider?: string;
}

export function createEmbeddingJob(data: CreateEmbeddingJobData) {
  return prisma.embeddingJob.create({
    data: { ...data, status: 'RUNNING', startedAt: new Date() },
  });
}

export interface CompleteEmbeddingJobData {
  status: Extract<EmbeddingJobStatus, 'SUCCEEDED' | 'FAILED'>;
  errorMessage?: string | null;
}

export async function completeEmbeddingJob(
  id: string,
  organizationId: string,
  data: CompleteEmbeddingJobData,
): Promise<void> {
  await prisma.embeddingJob.updateMany({
    where: { id, organizationId },
    data: { ...data, completedAt: new Date() },
  });
}

/** Marks a previously-FAILED job as RETRYING and bumps its retry counter — called right before the pipeline re-attempts it. */
export async function markEmbeddingJobRetrying(id: string, organizationId: string): Promise<void> {
  await prisma.embeddingJob.updateMany({
    where: { id, organizationId },
    data: { status: 'RETRYING', retryCount: { increment: 1 }, startedAt: new Date() },
  });
}

export interface EmbeddingJobStats {
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  retrying: number;
}

export async function getEmbeddingJobStats(organizationId: string): Promise<EmbeddingJobStats> {
  const groups = await prisma.embeddingJob.groupBy({
    by: ['status'],
    where: { organizationId },
    _count: { _all: true },
  });

  const stats: EmbeddingJobStats = { pending: 0, running: 0, succeeded: 0, failed: 0, retrying: 0 };
  for (const group of groups) {
    const key = group.status.toLowerCase() as Lowercase<EmbeddingJobStatus>;
    stats[key] = group._count._all;
  }
  return stats;
}
