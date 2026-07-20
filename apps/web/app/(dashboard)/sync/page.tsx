import Link from 'next/link';

import { CONNECTOR_CATALOG } from '@bond-os/connectors';
import { syncJobQuerySchema } from '@bond-os/shared';
import {
  Badge,
  EmptyState,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@bond-os/ui';
import { RefreshCw } from 'lucide-react';

import { listSyncJobsService } from '@/features/sync/services/sync.service';
import { requireActiveOrganizationId } from '@/lib/organization';

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  SUCCEEDED: 'outline',
  FAILED: 'destructive',
  RUNNING: 'secondary',
  PENDING: 'secondary',
  RETRYING: 'secondary',
};

const TRIGGER_LABEL: Record<string, string> = {
  MANUAL: 'Manual',
  SCHEDULED: 'Scheduled',
  WEBHOOK: 'Webhook',
  INCREMENTAL: 'Incremental',
};

const PROVIDER_LABEL = new Map(CONNECTOR_CATALOG.map((entry) => [entry.provider, entry.displayName]));

function formatDate(date: Date | string | null): string {
  if (!date) return '—';
  return new Date(date).toLocaleString();
}

export default async function SyncPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const organizationId = await requireActiveOrganizationId();
  const query = syncJobQuerySchema.parse(await searchParams);
  const result = await listSyncJobsService(organizationId, query);

  const makeHref = (page: number) => {
    const params = new URLSearchParams();
    if (query.connectorId) params.set('connectorId', query.connectorId);
    params.set('page', String(page));
    return `/sync?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sync Status</h1>
        <p className="text-sm text-muted-foreground">History and outcomes of every connector sync.</p>
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title="No syncs yet"
          description="Trigger one from the Connectors page."
          action={
            <Link href="/connectors" className="text-sm font-medium underline underline-offset-4">
              Go to Connectors
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connector</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Processed</TableHead>
                <TableHead>Failed</TableHead>
                <TableHead>Retries</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.items.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">
                    {PROVIDER_LABEL.get(job.connectorProvider) ?? job.connectorProvider}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[job.status] ?? 'outline'}>{job.status}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {TRIGGER_LABEL[job.trigger] ?? job.trigger}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(job.startedAt)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{formatDate(job.completedAt)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{job.itemsProcessed}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{job.itemsFailed}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{job.retryCount}</TableCell>
                  <TableCell
                    className="max-w-xs truncate text-xs text-muted-foreground"
                    title={job.errorMessage ?? undefined}
                  >
                    {job.errorMessage ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination page={result.page} totalPages={result.totalPages} makeHref={makeHref} />
        </div>
      )}
    </div>
  );
}
