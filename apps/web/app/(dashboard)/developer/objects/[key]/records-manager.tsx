'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { ROUTES, type ApiResponse } from '@bond-os/shared';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@bond-os/ui';

import { RecordForm, type RenderableField } from '../../_components/record-form';

interface RecordDto {
  id: string;
  title: string;
  values: Record<string, unknown>;
  createdAt: string;
}

interface RecordsManagerProps {
  objectKey: string;
  objectName: string;
  fields: RenderableField[];
  initialRecords: RecordDto[];
  canManage: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function RecordsManager({ objectKey, objectName, fields, initialRecords, canManage }: RecordsManagerProps) {
  const [records, setRecords] = useState<RecordDto[]>(initialRecords);
  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});

  async function onCreate() {
    setSubmitting(true);
    try {
      const response = await fetch(`/api/custom-objects/${objectKey}/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      const result = (await response.json()) as ApiResponse<RecordDto>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setRecords((current) => [result.data, ...current]);
      toast.success('Record added.');
      setValues({});
      setIsOpen(false);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(id: string) {
    setPendingId(id);
    try {
      const response = await fetch(`/api/custom-objects/${objectKey}/records/${id}`, { method: 'DELETE' });
      const result = (await response.json()) as ApiResponse<{ id: string }>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setRecords((current) => current.filter((record) => record.id !== id));
      toast.success('Record deleted.');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingId(null);
    }
  }

  const previewFields = fields.slice(0, 2);

  return (
    <div className="space-y-4">
      <Link href={ROUTES.developerObjects} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Custom objects
      </Link>

      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{objectName}</h2>
          <p className="text-sm text-muted-foreground">
            {records.length} record{records.length === 1 ? '' : 's'} · {fields.length} field
            {fields.length === 1 ? '' : 's'}
          </p>
        </div>
        <Modal open={isOpen} onOpenChange={setIsOpen}>
          <ModalTrigger asChild>
            <Button disabled={fields.length === 0}>Add record</Button>
          </ModalTrigger>
          <ModalContent className="max-h-[85vh] overflow-y-auto">
            <ModalHeader>
              <ModalTitle>New {objectName}</ModalTitle>
              <ModalDescription>Fill in the fields defined for this object.</ModalDescription>
            </ModalHeader>
            <RecordForm fields={fields} values={values} onChange={setValues} />
            <ModalFooter>
              <Button onClick={onCreate} disabled={submitting}>
                {submitting ? 'Saving…' : 'Save record'}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>

      {records.length === 0 ? (
        <EmptyState title="No records yet" description="Add your first record to get started." />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                {previewFields.map((field) => (
                  <TableHead key={field.key}>{field.label}</TableHead>
                ))}
                <TableHead>Created</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="font-medium">{record.title}</TableCell>
                  {previewFields.map((field) => (
                    <TableCell key={field.key} className="text-sm text-muted-foreground">
                      {formatValue(record.values[field.key])}
                    </TableCell>
                  ))}
                  <TableCell className="text-sm text-muted-foreground">{formatDate(record.createdAt)}</TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm" className="text-destructive" disabled={pendingId === record.id}>
                            Delete
                          </Button>
                        }
                        title="Delete this record?"
                        description="This cannot be undone."
                        onConfirm={() => onDelete(record.id)}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
