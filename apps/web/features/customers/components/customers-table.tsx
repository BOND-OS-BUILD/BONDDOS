'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { CustomerListItem } from '@bond-os/database';
import { Badge, ConfirmDialog, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, toast } from '@bond-os/ui';
import { Trash2 } from 'lucide-react';

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

export function CustomersTable({ customers }: { customers: CustomerListItem[] }) {
  const router = useRouter();

  async function handleDelete(id: string) {
    const response = await fetch(`/api/customers/${id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!result.success) {
      toast.error(result.error.message);
      return;
    }
    toast.success('Customer deleted.');
    router.refresh();
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Email</TableHead>
          <TableHead>Projects</TableHead>
          <TableHead>Emails</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {customers.map((customer) => (
          <TableRow key={customer.id}>
            <TableCell className="font-medium">
              <Link href={`/customers/${customer.id}`} className="hover:underline">
                {customer.name}
              </Link>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{customer.company ?? '—'}</TableCell>
            <TableCell>
              <Badge variant={STATUS_VARIANT[customer.status] ?? 'outline'}>
                {STATUS_LABEL[customer.status] ?? customer.status}
              </Badge>
            </TableCell>
            <TableCell className="text-sm text-muted-foreground">{customer.email ?? '—'}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{customer.projectCount}</TableCell>
            <TableCell className="text-sm text-muted-foreground">{customer.emailCount}</TableCell>
            <TableCell>
              <ConfirmDialog
                trigger={
                  <button
                    type="button"
                    className="rounded-sm p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                    aria-label={`Delete ${customer.name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                }
                title={`Delete "${customer.name}"?`}
                description="This permanently deletes the customer and its logged emails. This can't be undone."
                onConfirm={() => handleDelete(customer.id)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
