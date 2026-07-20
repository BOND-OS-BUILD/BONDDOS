import Link from 'next/link';

import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@bond-os/ui';
import { History } from 'lucide-react';

import { ConnectorActions } from '@/features/connectors/components/connector-actions';
import { listConnectorsService } from '@/features/connectors/services/connector.service';
import { requireActiveOrganizationId } from '@/lib/organization';

const STATUS_VARIANT: Record<string, 'secondary' | 'outline' | 'destructive'> = {
  DISCONNECTED: 'secondary',
  CONNECTED: 'outline',
  ERROR: 'destructive',
  SYNCING: 'outline',
};

const STATUS_LABEL: Record<string, string> = {
  DISCONNECTED: 'Not connected',
  CONNECTED: 'Connected',
  ERROR: 'Error',
  SYNCING: 'Syncing',
};

export default async function ConnectorsPage() {
  const organizationId = await requireActiveOrganizationId();
  const items = await listConnectorsService(organizationId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Connectors</h1>
          <p className="text-sm text-muted-foreground">
            Connect external tools to bring their data into BOND OS.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/sync">
            <History className="mr-2 h-4 w-4" />
            View sync history
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const status = item.connector?.status ?? 'DISCONNECTED';
          return (
            <Card key={item.provider}>
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{item.displayName}</CardTitle>
                  <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>{STATUS_LABEL[status] ?? status}</Badge>
                </div>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Last synced:{' '}
                  {item.connector?.lastSyncAt ? new Date(item.connector.lastSyncAt).toLocaleString() : 'Never'}
                </p>
                <ConnectorActions provider={item.provider} displayName={item.displayName} connector={item.connector} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
