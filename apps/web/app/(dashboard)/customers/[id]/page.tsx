import { Badge, Card, CardContent, CardHeader, CardTitle, Separator } from '@bond-os/ui';
import { FolderKanban, Mail, Plus } from 'lucide-react';
import Link from 'next/link';

import { CustomerDeleteButton } from '@/features/customers/components/customer-delete-button';
import { CustomerEmailDialog } from '@/features/customers/components/customer-email-dialog';
import { CustomerFormDialog } from '@/features/customers/components/customer-form-dialog';
import { getCustomerService } from '@/features/customers/services/customer.service';
import { listProjectsService } from '@/features/projects/services/project.service';
import { requireActiveOrganizationId } from '@/lib/organization';

const STATUS_LABEL: Record<string, string> = {
  LEAD: 'Lead',
  ACTIVE: 'Active',
  CHURNED: 'Churned',
  ARCHIVED: 'Archived',
};

const STATUS_VARIANT: Record<string, 'outline' | 'secondary' | 'success' | 'destructive'> = {
  LEAD: 'outline',
  ACTIVE: 'success',
  CHURNED: 'destructive',
  ARCHIVED: 'secondary',
};

const DIRECTION_LABEL: Record<string, string> = {
  INCOMING: 'Incoming',
  OUTGOING: 'Outgoing',
};

const DIRECTION_VARIANT: Record<string, 'outline' | 'secondary'> = {
  INCOMING: 'secondary',
  OUTGOING: 'outline',
};

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const organizationId = await requireActiveOrganizationId();
  const [customer, projectsResult] = await Promise.all([
    getCustomerService(organizationId, id),
    listProjectsService(organizationId, { page: 1, pageSize: 200, sortBy: 'title', sortDir: 'asc' }),
  ]);
  const projects = projectsResult.items.map((project) => ({ id: project.id, title: project.title }));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
            <Badge variant={STATUS_VARIANT[customer.status] ?? 'outline'}>
              {STATUS_LABEL[customer.status] ?? customer.status}
            </Badge>
          </div>
          {customer.company ? <p className="text-sm text-muted-foreground">{customer.company}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <CustomerFormDialog
            customer={customer}
            projects={projects}
            trigger={<button className="text-sm font-medium underline underline-offset-4">Edit</button>}
          />
          <CustomerDeleteButton id={customer.id} name={customer.name} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-muted-foreground">Email</p>
          <p className="font-medium">{customer.email ?? '—'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Phone</p>
          <p className="font-medium">{customer.phone ?? '—'}</p>
        </div>
        <div>
          <p className="text-muted-foreground">Website</p>
          {customer.website ? (
            <a
              href={customer.website}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-4"
            >
              {customer.website}
            </a>
          ) : (
            <p className="font-medium">—</p>
          )}
        </div>
      </div>

      {customer.notes ? (
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Notes</p>
          <p className="max-w-2xl whitespace-pre-wrap text-sm">{customer.notes}</p>
        </div>
      ) : null}

      <Separator />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-4 w-4" /> Emails ({customer.emails.length})
            </CardTitle>
            <CustomerEmailDialog
              customerId={customer.id}
              projects={projects}
              trigger={
                <button className="inline-flex items-center gap-1 text-sm font-medium underline underline-offset-4">
                  <Plus className="h-3.5 w-3.5" /> Log email
                </button>
              }
            />
          </CardHeader>
          <CardContent className="space-y-2">
            {customer.emails.length === 0 ? (
              <p className="text-sm text-muted-foreground">No emails logged yet.</p>
            ) : (
              customer.emails.map((email) => (
                <div key={email.id} className="space-y-1 rounded-md border border-border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{email.subject}</span>
                    <Badge variant={DIRECTION_VARIANT[email.direction] ?? 'outline'}>
                      {DIRECTION_LABEL[email.direction] ?? email.direction}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">
                    {email.sender} → {email.recipient}
                  </p>
                  <p className="text-xs text-muted-foreground">{new Date(email.sentAt).toLocaleString()}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderKanban className="h-4 w-4" /> Projects ({customer.projects.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {customer.projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No linked projects yet.</p>
            ) : (
              customer.projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  className="flex items-center justify-between rounded-md border border-border p-2 text-sm hover:bg-accent"
                >
                  <span>{project.title}</span>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
