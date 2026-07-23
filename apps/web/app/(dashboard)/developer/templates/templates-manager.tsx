'use client';

import { useState } from 'react';
import { Download, Package } from 'lucide-react';

import { type ApiResponse, type TemplateTypeName } from '@bond-os/shared';
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

export interface TemplateDto {
  id: string;
  key: string;
  type: TemplateTypeName;
  name: string;
  description: string | null;
  author: string | null;
  version: string;
  isPublic: boolean;
  isOwn: boolean;
  createdAt: string;
}

const TEMPLATE_TYPES: TemplateTypeName[] = [
  'WORKFLOW',
  'AI_PROMPT',
  'PROJECT',
  'DOCUMENT',
  'KNOWLEDGE_GRAPH_VIEW',
  'DASHBOARD',
];

const NATIVE_SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

function typeLabel(type: TemplateTypeName): string {
  return type
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function TemplatesManager({ initialTemplates, canManage }: { initialTemplates: TemplateDto[]; canManage: boolean }) {
  const [templates, setTemplates] = useState<TemplateDto[]>(initialTemplates);
  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<TemplateTypeName>('AI_PROMPT');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [contentText, setContentText] = useState('{\n  \n}');

  function reset() {
    setName('');
    setKey('');
    setType('AI_PROMPT');
    setDescription('');
    setIsPublic(false);
    setContentText('{\n  \n}');
  }

  async function onCreate() {
    let content: unknown;
    try {
      content = JSON.parse(contentText);
    } catch {
      toast.error('Content must be valid JSON.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key || slugify(name), name, type, description: description || undefined, isPublic, content }),
      });
      const result = (await response.json()) as ApiResponse<TemplateDto>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setTemplates((current) => [result.data, ...current]);
      toast.success('Template created.');
      reset();
      setIsOpen(false);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onUse(template: TemplateDto) {
    setPendingId(template.id);
    try {
      const response = await fetch(`/api/templates/${template.id}/use`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = (await response.json()) as ApiResponse<{ createdKind: string | null }>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success(
        result.data.createdKind ? `Created a ${result.data.createdKind} from this template.` : 'Template ready to apply.',
      );
    } catch {
      toast.error('Could not use template.');
    } finally {
      setPendingId(null);
    }
  }

  async function onDelete(id: string) {
    setPendingId(id);
    try {
      const response = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      const result = (await response.json()) as ApiResponse<{ id: string }>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setTemplates((current) => current.filter((template) => template.id !== id));
      toast.success('Template deleted.');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Templates</h2>
          <p className="text-sm text-muted-foreground">
            Reusable workflows, prompts, projects and dashboards. Import to apply, export to share.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" asChild>
            <a href="/api/export" download>
              <Download className="mr-1 h-4 w-4" /> Export data
            </a>
          </Button>
          {canManage && (
            <Modal open={isOpen} onOpenChange={setIsOpen}>
              <ModalTrigger asChild>
                <Button>New template</Button>
              </ModalTrigger>
              <ModalContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
                <ModalHeader>
                  <ModalTitle>New template</ModalTitle>
                  <ModalDescription>Paste the template content as JSON. Public templates are visible to other organizations.</ModalDescription>
                </ModalHeader>
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Name</Label>
                      <Input value={name} onChange={(event) => { setName(event.target.value); if (!key) setKey(slugify(event.target.value)); }} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Type</Label>
                      <select className={NATIVE_SELECT_CLASS} value={type} onChange={(event) => setType(event.target.value as TemplateTypeName)}>
                        {TEMPLATE_TYPES.map((templateType) => (
                          <option key={templateType} value={templateType}>
                            {typeLabel(templateType)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Description (optional)</Label>
                    <Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Content (JSON)</Label>
                    <Textarea rows={8} className="font-mono text-xs" value={contentText} onChange={(event) => setContentText(event.target.value)} />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
                    Make public (shareable across organizations)
                  </label>
                </div>
                <ModalFooter>
                  <Button onClick={onCreate} disabled={submitting || !name.trim()}>
                    {submitting ? 'Creating…' : 'Create template'}
                  </Button>
                </ModalFooter>
              </ModalContent>
            </Modal>
          )}
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyState icon={Package} title="No templates yet" description="Create one, or import a public template to get started." />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell>
                    <p className="text-sm font-medium">{template.name}</p>
                    {template.description && <p className="max-w-md truncate text-xs text-muted-foreground">{template.description}</p>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{typeLabel(template.type)}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={template.isPublic ? 'secondary' : 'outline'}>{template.isPublic ? 'Public' : 'Private'}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" disabled={pendingId === template.id} onClick={() => onUse(template)}>
                        Use
                      </Button>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={`/api/templates/${template.id}`} target="_blank" rel="noreferrer">
                          Export
                        </a>
                      </Button>
                      {canManage && template.isOwn && (
                        <ConfirmDialog
                          trigger={
                            <Button variant="ghost" size="sm" className="text-destructive" disabled={pendingId === template.id}>
                              Delete
                            </Button>
                          }
                          title="Delete this template?"
                          description="This cannot be undone."
                          onConfirm={() => onDelete(template.id)}
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
    </div>
  );
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}
