'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Check, Copy, Webhook } from 'lucide-react';

import {
  createWebhookSchema,
  EVENT_CATALOG,
  type ApiResponse,
  type CreateWebhookInput,
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

export interface WebhookDto {
  id: string;
  url: string;
  events: string[];
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface CreatedWebhookResult {
  webhook: WebhookDto;
  secret: string;
}

interface DeliveryDto {
  id: string;
  subscriptionId: string;
  eventType: string;
  status: 'PENDING' | 'DELIVERED' | 'FAILED' | 'RETRYING';
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
}

const DELIVERY_VARIANT: Record<DeliveryDto['status'], 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DELIVERED: 'secondary',
  PENDING: 'outline',
  RETRYING: 'outline',
  FAILED: 'destructive',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function WebhooksManager({ initialWebhooks }: { initialWebhooks: WebhookDto[] }) {
  const [webhooks, setWebhooks] = useState<WebhookDto[]>(initialWebhooks);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ url: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [deliveriesFor, setDeliveriesFor] = useState<WebhookDto | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryDto[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  const form = useForm<CreateWebhookInput>({
    resolver: zodResolver(createWebhookSchema),
    defaultValues: { url: '', events: [], description: '' },
  });

  const selectedEvents = form.watch('events');

  function toggleEvent(type: string, checked: boolean) {
    const next = checked ? [...selectedEvents, type] : selectedEvents.filter((value) => value !== type);
    form.setValue('events', next, { shouldValidate: form.formState.isSubmitted });
  }

  async function onCreate(values: CreateWebhookInput) {
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = (await response.json()) as ApiResponse<CreatedWebhookResult>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setWebhooks((current) => [result.data.webhook, ...current]);
      setRevealed({ url: result.data.webhook.url, secret: result.data.secret });
      setCopied(false);
      toast.success('Webhook created.');
      form.reset({ url: '', events: [], description: '' });
      setIsCreateOpen(false);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function toggleEnabled(webhook: WebhookDto) {
    setPendingId(webhook.id);
    try {
      const response = await fetch(`/api/webhooks/${webhook.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !webhook.enabled }),
      });
      const result = (await response.json()) as ApiResponse<WebhookDto>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setWebhooks((current) => current.map((item) => (item.id === webhook.id ? result.data : item)));
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingId(null);
    }
  }

  async function handleDelete(id: string) {
    setPendingId(id);
    try {
      const response = await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
      const result = (await response.json()) as ApiResponse<{ id: string }>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setWebhooks((current) => current.filter((item) => item.id !== id));
      toast.success('Webhook deleted.');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingId(null);
    }
  }

  async function openDeliveries(webhook: WebhookDto) {
    setDeliveriesFor(webhook);
    setLoadingDeliveries(true);
    setDeliveries([]);
    try {
      const response = await fetch(`/api/webhooks/${webhook.id}/deliveries?pageSize=20`);
      const result = (await response.json()) as ApiResponse<{ items: DeliveryDto[] }>;
      if (result.success) setDeliveries(result.data.items);
    } catch {
      toast.error('Could not load deliveries.');
    } finally {
      setLoadingDeliveries(false);
    }
  }

  async function replay(deliveryId: string) {
    try {
      const response = await fetch(`/api/webhooks/deliveries/${deliveryId}/replay`, { method: 'POST' });
      const result = (await response.json()) as ApiResponse<DeliveryDto>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setDeliveries((current) => [result.data, ...current]);
      toast.success(result.data.status === 'DELIVERED' ? 'Delivered.' : `Replay ${result.data.status.toLowerCase()}.`);
    } catch {
      toast.error('Replay failed.');
    }
  }

  async function processRetries() {
    try {
      const response = await fetch('/api/webhooks/process-retries', { method: 'POST' });
      const result = (await response.json()) as ApiResponse<{ processed: number; delivered: number }>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      toast.success(`Processed ${result.data.processed} — ${result.data.delivered} delivered.`);
      if (deliveriesFor) void openDeliveries(deliveriesFor);
    } catch {
      toast.error('Could not process retries.');
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Webhooks</h2>
          <p className="text-sm text-muted-foreground">
            Receive signed HTTP callbacks when events happen in your organization.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={processRetries}>
            Process retries
          </Button>
          <Modal open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <ModalTrigger asChild>
              <Button>Add webhook</Button>
            </ModalTrigger>
            <ModalContent className="max-h-[85vh] overflow-y-auto">
              <ModalHeader>
                <ModalTitle>Add webhook</ModalTitle>
                <ModalDescription>
                  We&apos;ll POST a signed JSON payload to your endpoint for each subscribed event.
                </ModalDescription>
              </ModalHeader>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onCreate)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="url"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Endpoint URL</FormLabel>
                        <FormControl>
                          <Input placeholder="https://example.com/webhooks/bondos" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Description (optional)</FormLabel>
                        <FormControl>
                          <Textarea rows={2} placeholder="What is this endpoint for?" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="events"
                    render={() => (
                      <FormItem>
                        <FormLabel>Events</FormLabel>
                        <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
                          {EVENT_CATALOG.map((entry) => {
                            const checked = selectedEvents.includes(entry.type);
                            return (
                              <label key={entry.type} className="flex cursor-pointer items-start gap-2 text-sm">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(value) => toggleEvent(entry.type, value === true)}
                                  className="mt-0.5"
                                />
                                <span>
                                  <code className="text-xs font-medium">{entry.type}</code>
                                  <span className="block text-xs text-muted-foreground">{entry.description}</span>
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
                      {isSubmitting ? 'Creating…' : 'Add webhook'}
                    </Button>
                  </ModalFooter>
                </form>
              </Form>
            </ModalContent>
          </Modal>
        </div>
      </div>

      {webhooks.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title="No webhooks yet"
          description="Add an endpoint to start receiving events."
        />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Endpoint</TableHead>
                <TableHead>Events</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {webhooks.map((webhook) => (
                <TableRow key={webhook.id}>
                  <TableCell>
                    <p className="max-w-xs truncate text-sm font-medium">{webhook.url}</p>
                    {webhook.description && (
                      <p className="max-w-xs truncate text-xs text-muted-foreground">{webhook.description}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {webhook.events.slice(0, 2).map((event) => (
                        <Badge key={event} variant="outline" className="text-[10px]">
                          {event}
                        </Badge>
                      ))}
                      {webhook.events.length > 2 && (
                        <Badge variant="outline" className="text-[10px]">
                          +{webhook.events.length - 2}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={webhook.enabled ? 'secondary' : 'outline'}>
                      {webhook.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openDeliveries(webhook)}>
                        Deliveries
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pendingId === webhook.id}
                        onClick={() => toggleEnabled(webhook)}
                      >
                        {webhook.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <ConfirmDialog
                        trigger={
                          <Button variant="ghost" size="sm" className="text-destructive" disabled={pendingId === webhook.id}>
                            Delete
                          </Button>
                        }
                        title="Delete this webhook?"
                        description="The endpoint will stop receiving events. This cannot be undone."
                        onConfirm={() => handleDelete(webhook.id)}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Secret reveal */}
      <Modal open={revealed !== null} onOpenChange={(open) => !open && setRevealed(null)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Copy your signing secret</ModalTitle>
            <ModalDescription>
              Use this to verify the <code className="text-xs">X-BondOS-Signature</code> header on requests to{' '}
              <span className="font-medium">{revealed?.url}</span>. It won&apos;t be shown again.
            </ModalDescription>
          </ModalHeader>
          <Card>
            <CardContent className="flex items-center justify-between gap-3 py-3">
              <code className="break-all text-xs">{revealed?.secret}</code>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => revealed && copySecret(revealed.secret)}
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

      {/* Deliveries */}
      <Modal open={deliveriesFor !== null} onOpenChange={(open) => !open && setDeliveriesFor(null)}>
        <ModalContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <ModalHeader>
            <ModalTitle>Recent deliveries</ModalTitle>
            <ModalDescription className="max-w-md truncate">{deliveriesFor?.url}</ModalDescription>
          </ModalHeader>
          {loadingDeliveries ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : deliveries.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No deliveries yet.</p>
          ) : (
            <div className="space-y-2">
              {deliveries.map((delivery) => (
                <div
                  key={delivery.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant={DELIVERY_VARIANT[delivery.status]}>{delivery.status}</Badge>
                      <code className="text-xs">{delivery.eventType}</code>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(delivery.createdAt)} · {delivery.attempts} attempt
                      {delivery.attempts === 1 ? '' : 's'}
                      {delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : ''}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => replay(delivery.id)}>
                    Replay
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
