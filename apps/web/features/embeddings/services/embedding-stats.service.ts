import { requireRole } from '@bond-os/auth';
import { getEmbeddingJobStats, getEmbeddingStats, type EmbeddingJobStats, type EmbeddingStats } from '@bond-os/database';
import { ROLES } from '@bond-os/shared';

/** Backs the Embeddings/Retrieval/Memory Status pages' stat cards — thin, requireRole-checked wrappers over the repository aggregation queries. */

export async function getEmbeddingStatsService(organizationId: string): Promise<EmbeddingStats> {
  await requireRole(organizationId, ROLES.MEMBER);
  return getEmbeddingStats(organizationId);
}

export async function getEmbeddingJobStatsService(organizationId: string): Promise<EmbeddingJobStats> {
  await requireRole(organizationId, ROLES.MEMBER);
  return getEmbeddingJobStats(organizationId);
}
