'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Boxes } from 'lucide-react';

import { ROUTES, type ApiResponse } from '@bond-os/shared';
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Label,
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
  Textarea,
  toast,
} from '@bond-os/ui';

import { emptyField, FieldsEditor, type EditableField } from '../_components/fields-editor';

export interface ObjectDto {
  key: string;
  name: string;
  pluralName: string | null;
  description: string | null;
  icon: string | null;
  fieldCount: number;
  createdAt: string;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

export function ObjectsManager({ initialObjects, canManage }: { initialObjects: ObjectDto[]; canManage: boolean }) {
  const router = useRouter();
  const [objects, setObjects] = useState<ObjectDto[]>(initialObjects);
  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<EditableField[]>([emptyField()]);

  function reset() {
    setName('');
    setKey('');
    setDescription('');
    setFields([emptyField()]);
  }

  async function onCreate() {
    setSubmitting(true);
    try {
      const response = await fetch('/api/custom-objects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key || slugify(name),
          name,
          description: description || undefined,
          fields: fields
            .filter((field) => field.label.trim())
            .map((field) => ({ ...field, key: field.key || slugify(field.label) })),
        }),
      });
      const result = (await response.json()) as ApiResponse<ObjectDto & { fields: unknown[] }>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setObjects((current) => [...current, { ...result.data, fieldCount: result.data.fields.length }]);
      toast.success('Custom object created.');
      reset();
      setIsOpen(false);
      router.refresh();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Custom objects</h2>
          <p className="text-sm text-muted-foreground">
            Define your own entities. Records are stored in the Knowledge Graph and are searchable.
          </p>
        </div>
        {canManage && (
          <Modal open={isOpen} onOpenChange={setIsOpen}>
            <ModalTrigger asChild>
              <Button>New object</Button>
            </ModalTrigger>
            <ModalContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
              <ModalHeader>
                <ModalTitle>New custom object</ModalTitle>
                <ModalDescription>Give it a name and define its fields.</ModalDescription>
              </ModalHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      placeholder="e.g. Invoice"
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        if (!key) setKey(slugify(event.target.value));
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Key</Label>
                    <Input placeholder="invoice" value={key} onChange={(event) => setKey(event.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Description (optional)</Label>
                  <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Fields</Label>
                  <FieldsEditor fields={fields} onChange={setFields} />
                </div>
              </div>
              <ModalFooter>
                <Button onClick={onCreate} disabled={submitting || !name.trim()}>
                  {submitting ? 'Creating…' : 'Create object'}
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
      </div>

      {objects.length === 0 ? (
        <EmptyState icon={Boxes} title="No custom objects yet" description="Create one to model data unique to your organization." />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead className="text-right">Records</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {objects.map((object) => (
                <TableRow key={object.key}>
                  <TableCell className="font-medium">{object.name}</TableCell>
                  <TableCell>
                    <code className="text-xs text-muted-foreground">{object.key}</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{object.fieldCount}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`${ROUTES.developerObjects}/${object.key}`}>Open</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
