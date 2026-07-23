'use client';

import { useState } from 'react';
import { FileCode } from 'lucide-react';

import type { ApiResponse } from '@bond-os/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
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
import { RecordForm } from '../_components/record-form';

interface FormFieldDto {
  key: string;
  label: string;
  fieldType: EditableField['fieldType'];
  required: boolean;
  options: string[];
}

export interface FormDto {
  key: string;
  name: string;
  description: string | null;
  fields: FormFieldDto[];
  customObjectKey: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface FormsManagerProps {
  initialForms: FormDto[];
  objectOptions: { key: string; name: string }[];
  canManage: boolean;
}

const NATIVE_SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
}

export function FormsManager({ initialForms, objectOptions, canManage }: FormsManagerProps) {
  const [forms, setForms] = useState<FormDto[]>(initialForms);
  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [customObjectKey, setCustomObjectKey] = useState('');
  const [fields, setFields] = useState<EditableField[]>([emptyField()]);
  const [previewForm, setPreviewForm] = useState<FormDto | null>(null);
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({});

  function reset() {
    setName('');
    setKey('');
    setDescription('');
    setCustomObjectKey('');
    setFields([emptyField()]);
  }

  async function onCreate() {
    setSubmitting(true);
    try {
      const response = await fetch('/api/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: key || slugify(name),
          name,
          description: description || undefined,
          customObjectKey: customObjectKey || undefined,
          fields: fields
            .filter((field) => field.label.trim())
            .map((field) => ({ ...field, key: field.key || slugify(field.label) })),
        }),
      });
      const result = (await response.json()) as ApiResponse<FormDto>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setForms((current) => [result.data, ...current]);
      toast.success('Form created.');
      reset();
      setIsOpen(false);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onDelete(formKey: string) {
    setPendingKey(formKey);
    try {
      const response = await fetch(`/api/forms/${formKey}`, { method: 'DELETE' });
      const result = (await response.json()) as ApiResponse<{ key: string }>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setForms((current) => current.filter((form) => form.key !== formKey));
      toast.success('Form deleted.');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingKey(null);
    }
  }

  function openPreview(form: FormDto) {
    setPreviewForm(form);
    setPreviewValues({});
  }

  async function submitPreview() {
    if (!previewForm) return;
    try {
      const response = await fetch(`/api/forms/${previewForm.key}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: previewValues }),
      });
      const result = (await response.json()) as ApiResponse<{ recordId: string | null }>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success(result.data.recordId ? 'Submitted — record created.' : 'Submitted.');
      setPreviewForm(null);
    } catch {
      toast.error('Submission failed.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Forms</h2>
          <p className="text-sm text-muted-foreground">
            Build validated forms. Point one at a custom object to turn submissions into records.
          </p>
        </div>
        {canManage && (
          <Modal open={isOpen} onOpenChange={setIsOpen}>
            <ModalTrigger asChild>
              <Button>New form</Button>
            </ModalTrigger>
            <ModalContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
              <ModalHeader>
                <ModalTitle>New form</ModalTitle>
                <ModalDescription>Define the fields respondents will fill in.</ModalDescription>
              </ModalHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Name</Label>
                    <Input
                      placeholder="e.g. Contact request"
                      value={name}
                      onChange={(event) => {
                        setName(event.target.value);
                        if (!key) setKey(slugify(event.target.value));
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Key</Label>
                    <Input value={key} onChange={(event) => setKey(event.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Description (optional)</Label>
                  <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Create records in (optional)</Label>
                  <select
                    className={NATIVE_SELECT_CLASS}
                    value={customObjectKey}
                    onChange={(event) => setCustomObjectKey(event.target.value)}
                  >
                    <option value="">No — validate only</option>
                    {objectOptions.map((object) => (
                      <option key={object.key} value={object.key}>
                        {object.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label>Fields</Label>
                  <FieldsEditor fields={fields} onChange={setFields} />
                </div>
              </div>
              <ModalFooter>
                <Button onClick={onCreate} disabled={submitting || !name.trim()}>
                  {submitting ? 'Creating…' : 'Create form'}
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
      </div>

      {forms.length === 0 ? (
        <EmptyState icon={FileCode} title="No forms yet" description="Create a form to collect structured input." />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Fields</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {forms.map((form) => (
                <TableRow key={form.key}>
                  <TableCell className="font-medium">{form.name}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{form.fields.length}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {form.customObjectKey ? <code className="text-xs">{form.customObjectKey}</code> : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={form.enabled ? 'secondary' : 'outline'}>
                      {form.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openPreview(form)}>
                        Preview
                      </Button>
                      {canManage && (
                        <ConfirmDialog
                          trigger={
                            <Button variant="ghost" size="sm" className="text-destructive" disabled={pendingKey === form.key}>
                              Delete
                            </Button>
                          }
                          title="Delete this form?"
                          description="This cannot be undone."
                          onConfirm={() => onDelete(form.key)}
                        />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Modal open={previewForm !== null} onOpenChange={(open) => !open && setPreviewForm(null)}>
        <ModalContent className="max-h-[85vh] overflow-y-auto">
          <ModalHeader>
            <ModalTitle>{previewForm?.name}</ModalTitle>
            <ModalDescription>{previewForm?.description ?? 'Preview and test this form.'}</ModalDescription>
          </ModalHeader>
          {previewForm && <RecordForm fields={previewForm.fields} values={previewValues} onChange={setPreviewValues} />}
          <ModalFooter>
            <Button onClick={submitPreview}>Submit</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
