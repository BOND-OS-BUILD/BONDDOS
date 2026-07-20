'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { ROUTES } from '@bond-os/shared';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  Spinner,
  toast,
} from '@bond-os/ui';
import { AlertTriangle, LayoutTemplate } from 'lucide-react';

/** Shape returned by `GET /api/workflows/templates` — see `app/api/workflows/templates/route.ts`. Metadata only, no `graph`. */
interface WorkflowTemplateSummary {
  templateKey: string;
  name: string;
  description: string;
  triggerType: string;
}

interface CreatedWorkflow {
  id: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

/** Slugifies a template key into a starting-point `workflowKey` suggestion — still freely editable before submit. */
function suggestWorkflowKey(templateKey: string): string {
  const slug = templateKey
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `${slug}-${Date.now().toString(36)}`.slice(0, 100);
}

/**
 * Inline "browse templates" picker on the Workflows list page — fetches the
 * built-in Workflow Template catalog client-side and lets a member turn one
 * into an editable DRAFT via `POST /api/workflows/templates/{key}/instantiate`,
 * then routes to that draft's builder. Deliberately simple: no filtering/
 * search, no template preview beyond name+description — see
 * `workflow-builder-canvas.tsx` for where this pass's design effort went.
 */
export function WorkflowTemplatesSection() {
  const [templates, setTemplates] = React.useState<WorkflowTemplateSummary[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const response = await fetch('/api/workflows/templates');
        const json = (await response.json()) as ApiEnvelope<WorkflowTemplateSummary[]>;
        if (!json.success || !json.data) {
          throw new Error(json.error?.message ?? 'Failed to load workflow templates.');
        }
        if (!cancelled) setTemplates(json.data);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Failed to load workflow templates.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Templates</CardTitle>
        <CardDescription>
          Start from a pre-built workflow instead of assembling one step by step. Using a template creates a new
          DRAFT you can then edit in the builder before publishing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Spinner />
          </div>
        ) : loadError ? (
          <EmptyState icon={AlertTriangle} title="Couldn't load templates" description={loadError} />
        ) : templates.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            title="No templates available"
            description="No workflow templates have been published yet."
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <TemplateCard key={template.templateKey} template={template} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TemplateCard({ template }: { template: WorkflowTemplateSummary }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [workflowKey, setWorkflowKey] = React.useState(() => suggestWorkflowKey(template.templateKey));
  const [name, setName] = React.useState(template.name);
  const [isPending, setIsPending] = React.useState(false);

  async function handleInstantiate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedKey = workflowKey.trim();
    if (!trimmedKey) return;

    setIsPending(true);
    try {
      const response = await fetch(`/api/workflows/templates/${encodeURIComponent(template.templateKey)}/instantiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workflowKey: trimmedKey, name: name.trim() || undefined }),
      });
      const result = (await response.json()) as ApiEnvelope<CreatedWorkflow>;
      if (!result.success || !result.data) {
        toast.error(result.error?.message ?? 'Failed to create a workflow from this template.');
        return;
      }
      toast.success('Draft workflow created.');
      setOpen(false);
      router.push(`${ROUTES.workflowBuilder}/${result.data.id}`);
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <CardTitle className="text-sm">{template.name}</CardTitle>
        <CardDescription className="line-clamp-3">{template.description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto pt-0">
        <Modal open={open} onOpenChange={setOpen}>
          <ModalTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="w-full">
              Use this template
            </Button>
          </ModalTrigger>
          <ModalContent className="sm:max-w-md">
            <ModalHeader>
              <ModalTitle>Use {template.name}</ModalTitle>
              <ModalDescription>
                This creates a new DRAFT workflow from the template, which you can then edit in the builder before
                publishing.
              </ModalDescription>
            </ModalHeader>
            <form className="space-y-4" onSubmit={handleInstantiate} noValidate>
              <div className="space-y-2">
                <Label htmlFor={`template-${template.templateKey}-name`}>Name</Label>
                <Input
                  id={`template-${template.templateKey}-name`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`template-${template.templateKey}-key`}>Workflow key</Label>
                <Input
                  id={`template-${template.templateKey}-key`}
                  value={workflowKey}
                  onChange={(event) => setWorkflowKey(event.target.value)}
                  maxLength={100}
                />
                <p className="text-xs text-muted-foreground">
                  A unique identifier for this workflow within your organization.
                </p>
              </div>
              <ModalFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                  Cancel
                </Button>
                <Button type="submit" disabled={isPending || !workflowKey.trim()}>
                  {isPending ? 'Creating…' : 'Create draft'}
                </Button>
              </ModalFooter>
            </form>
          </ModalContent>
        </Modal>
      </CardContent>
    </Card>
  );
}
