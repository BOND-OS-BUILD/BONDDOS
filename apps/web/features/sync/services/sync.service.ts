import { requireRole } from '@bond-os/auth';
import { createConnector } from '@bond-os/connectors';
import {
  completeSyncJob,
  createSyncJob,
  getConnectorById,
  listSyncJobs,
  prisma,
  updateConnectorStatus,
  type SyncJobSummary,
} from '@bond-os/database';
import { NotFoundError, ROLES, type PaginatedResult, type SyncJobQuery } from '@bond-os/shared';

export async function listSyncJobsService(
  organizationId: string,
  query: SyncJobQuery,
): Promise<PaginatedResult<SyncJobSummary>> {
  await requireRole(organizationId, ROLES.MEMBER);
  return listSyncJobs({ organizationId, ...query });
}

/**
 * Runs a manual sync for a connector and records the outcome as a `SyncJob`.
 * Every provider is a stub in this phase — `.sync()` always throws
 * `ConnectorNotImplementedError` — so a `FAILED` job with that message is the
 * correct, expected result right now, not a bug to hide.
 */
export async function triggerSyncService(organizationId: string, connectorId: string) {
  await requireRole(organizationId, ROLES.MEMBER);

  const connector = await getConnectorById(connectorId, organizationId);
  if (!connector) throw new NotFoundError('Connector not found.');

  const job = await createSyncJob({ organizationId, connectorId, trigger: 'MANUAL' });

  try {
    const instance = createConnector(connector.provider);
    const result = await instance.sync({ trigger: 'MANUAL' });
    await completeSyncJob(job.id, organizationId, {
      status: 'SUCCEEDED',
      itemsProcessed: result.itemsProcessed,
      itemsFailed: result.itemsFailed,
    });
    await updateConnectorStatus(connectorId, organizationId, 'CONNECTED', new Date());
  } catch (error) {
    await completeSyncJob(job.id, organizationId, {
      status: 'FAILED',
      itemsProcessed: 0,
      itemsFailed: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    await updateConnectorStatus(connectorId, organizationId, 'ERROR');
  }

  return prisma.syncJob.findUniqueOrThrow({ where: { id: job.id } });
}
