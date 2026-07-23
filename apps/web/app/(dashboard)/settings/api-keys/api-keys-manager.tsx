'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Check, Copy, KeyRound } from 'lucide-react';

import {
  API_SCOPES,
  createApiKeySchema,
  type ApiResponse,
  type CreateApiKeyInput,
} from '@bond-os/shared';
import {
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  ConfirmDialog,
  EmptyState,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
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
  toast,
} from '@bond-os/ui';

/** Mirrors `ApiKeyView` from the service (types are structural). */
export interface ApiKeyDto {
  id: string;
  name: string;
  type: 'PERSONAL' | 'ORGANIZATION';
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  isOwn: boolean;
}

interface CreatedKeyResult {
  key: ApiKeyDto;
  plaintext: string;
}

interface ApiKeysManagerProps {
  initialKeys: ApiKeyDto[];
  canManageOrgKeys: boolean;
}

const EXPIRY_OPTIONS: { label: string; days: number | undefined }[] = [
  { label: 'No expiry', days: undefined },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
];

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function keyStatus(key: ApiKeyDto): { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' } {
  if (key.revokedAt) return { label: 'Revoked', variant: 'destructive' };
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) {
    return { label: 'Expired', variant: 'outline' };
  }
  return { label: 'Active', variant: 'secondary' };
}

export function ApiKeysManager({ initialKeys, canManageOrgKeys }: ApiKeysManagerProps) {
  const [keys, setKeys] = useState<ApiKeyDto[]>(initialKeys);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [expiryDays, setExpiryDays] = useState<number | undefined>(undefined);
  const [revealed, setRevealed] = useState<{ name: string; plaintext: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const form = useForm<CreateApiKeyInput>({
    resolver: zodResolver(createApiKeySchema),
    defaultValues: { name: '', type: 'PERSONAL', scopes: [] },
  });

  const selectedScopes = form.watch('scopes');

  function toggleScope(scope: string, checked: boolean) {
    const next = checked
      ? [...selectedScopes, scope]
      : selectedScopes.filter((value) => value !== scope);
    form.setValue('scopes', next, { shouldValidate: form.formState.isSubmitted });
  }

  async function onCreate(values: CreateApiKeyInput) {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, expiresInDays: expiryDays }),
      });
      const result = (await response.json()) as ApiResponse<CreatedKeyResult>;

      if (!result.success) {
        toast.error(result.error.message);
        return;
      }

      setKeys((current) => [result.data.key, ...current]);
      setRevealed({ name: result.data.key.name, plaintext: result.data.plaintext });
      setCopied(false);
      toast.success('API key created.');
      form.reset({ name: '', type: 'PERSONAL', scopes: [] });
      setExpiryDays(undefined);
      setIsCreateOpen(false);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRevoke(id: string) {
    setPendingId(id);
    try {
      const response = await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
      const result = (await response.json()) as ApiResponse<ApiKeyDto>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setKeys((current) => current.map((key) => (key.id === id ? result.data : key)));
      toast.success('API key revoked.');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingId(null);
    }
  }

  async function handleRotate(id: string) {
    setPendingId(id);
    try {
      const response = await fetch(`/api/api-keys/${id}/rotate`, { method: 'POST' });
      const result = (await response.json()) as ApiResponse<CreatedKeyResult>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setKeys((current) => current.map((key) => (key.id === id ? result.data.key : key)));
      setRevealed({ name: result.data.key.name, plaintext: result.data.plaintext });
      setCopied(false);
      toast.success('API key rotated. Update your integrations with the new secret.');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingId(null);
    }
  }

  async function copySecret(secret: string) {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      toast.success('Copied to clipboard.');
    } catch {
      toast.error('Could not copy — select and copy manually.');
    }
  }

  function canManageRow(key: ApiKeyDto): boolean {
    return key.type === 'ORGANIZATION' ? canManageOrgKeys : key.isOwn || canManageOrgKeys;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">API keys</h2>
          <p className="text-sm text-muted-foreground">
            Authenticate the public API (<code className="text-xs">/api/v1</code>) with a bearer token. Secrets are
            shown once at creation.
          </p>
        </div>
        <Modal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <ModalTrigger asChild>
            <Button>Create key</Button>
          </ModalTrigger>
          <ModalContent className="max-h-[85vh] overflow-y-auto">
            <ModalHeader>
              <ModalTitle>Create API key</ModalTitle>
              <ModalDescription>Grant only the scopes this key needs. You can revoke or rotate it at any time.</ModalDescription>
            </ModalHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onCreate)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Zapier integration" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {canManageOrgKeys && (
                  <FormField
                    control={form.control}
                    name="type"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Type</FormLabel>
                        <FormControl>
                          <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            {...field}
                          >
                            <option value="PERSONAL">Personal — acts as you</option>
                            <option value="ORGANIZATION">Organization — shared, org-wide</option>
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <div className="space-y-2">
                  <Label>Expiry</Label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    value={expiryDays ?? ''}
                    onChange={(event) => setExpiryDays(event.target.value ? Number(event.target.value) : undefined)}
                  >
                    {EXPIRY_OPTIONS.map((option) => (
                      <option key={option.label} value={option.days ?? ''}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <FormField
                  control={form.control}
                  name="scopes"
                  render={() => (
                    <FormItem>
                      <FormLabel>Scopes</FormLabel>
                      <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
                        {API_SCOPES.map((definition) => {
                          const checked = selectedScopes.includes(definition.scope);
                          return (
                            <label
                              key={definition.scope}
                              className="flex cursor-pointer items-start gap-2 text-sm"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(value) => toggleScope(definition.scope, value === true)}
                                className="mt-0.5"
                              />
                              <span>
                                <code className="text-xs font-medium">{definition.scope}</code>
                                <span className="block text-xs text-muted-foreground">{definition.description}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <ModalFooter>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Creating…' : 'Create key'}
                  </Button>
                </ModalFooter>
              </form>
            </Form>
          </ModalContent>
        </Modal>
      </div>

      {keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys yet"
          description="Create a key to start using the public API."
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Key</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((key) => {
                const status = keyStatus(key);
                const manageable = canManageRow(key) && !key.revokedAt;
                return (
                  <TableRow key={key.id}>
                    <TableCell>
                      <p className="text-sm font-medium">{key.name}</p>
                      {!key.isOwn && key.type === 'PERSONAL' && (
                        <span className="text-xs text-muted-foreground">Another member&apos;s key</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs text-muted-foreground">{key.prefix}…</code>
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.type === 'ORGANIZATION' ? 'default' : 'outline'}>
                        {key.type === 'ORGANIZATION' ? 'Org' : 'Personal'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.slice(0, 3).map((scope) => (
                          <Badge key={scope} variant="outline" className="text-[10px]">
                            {scope}
                          </Badge>
                        ))}
                        {key.scopes.length > 3 && (
                          <Badge variant="outline" className="text-[10px]">
                            +{key.scopes.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDate(key.lastUsedAt)}</TableCell>
                    <TableCell className="text-right">
                      {manageable ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pendingId === key.id}
                            onClick={() => handleRotate(key.id)}
                          >
                            Rotate
                          </Button>
                          <ConfirmDialog
                            trigger={
                              <Button variant="ghost" size="sm" className="text-destructive" disabled={pendingId === key.id}>
                                Revoke
                              </Button>
                            }
                            title="Revoke this API key?"
                            description="Any integration using this key will immediately stop working. This cannot be undone."
                            confirmLabel="Revoke key"
                            onConfirm={() => handleRevoke(key.id)}
                          />
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Modal open={revealed !== null} onOpenChange={(open) => !open && setRevealed(null)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Copy your API key</ModalTitle>
            <ModalDescription>
              This is the only time the secret for <span className="font-medium">{revealed?.name}</span> will be shown.
              Store it somewhere safe.
            </ModalDescription>
          </ModalHeader>
          <Card>
            <CardContent className="flex items-center justify-between gap-3 py-3">
              <code className="break-all text-xs">{revealed?.plaintext}</code>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => revealed && copySecret(revealed.plaintext)}
              >
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="sr-only">Copy</span>
              </Button>
            </CardContent>
          </Card>
          <ModalFooter>
            <Button onClick={() => setRevealed(null)}>Done</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
