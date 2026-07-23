'use client';

import { useState } from 'react';
import { Puzzle, ShieldCheck } from 'lucide-react';

import type { ApiResponse } from '@bond-os/shared';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
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

export interface PluginDto {
  id: string;
  name: string;
  version: string;
  author: string | null;
  description: string | null;
  status: 'INSTALLED' | 'ENABLED' | 'DISABLED';
  grantedScopes: string[];
  permissions: string[];
  components: { slot: string; name: string; url?: string }[];
  hooks: { event: string; url?: string }[];
  routes: { path: string; method: string }[];
  installedAt: string;
}

const EXAMPLE_MANIFEST = `{
  "id": "time-tracker",
  "name": "Time Tracker",
  "version": "1.0.0",
  "author": "Acme Inc.",
  "description": "Log time against projects and tasks.",
  "permissions": ["projects:read", "tasks:read"],
  "routes": [{ "path": "/plugins/time-tracker/report", "method": "GET" }],
  "components": [{ "slot": "project.panel", "name": "Timesheet", "url": "https://example.com/embed" }],
  "hooks": [{ "event": "task.completed", "url": "https://example.com/webhooks/bondos" }]
}`;

const STATUS_VARIANT: Record<PluginDto['status'], 'secondary' | 'outline' | 'destructive'> = {
  ENABLED: 'secondary',
  INSTALLED: 'outline',
  DISABLED: 'outline',
};

export function PluginsManager({ initialPlugins, canManage }: { initialPlugins: PluginDto[]; canManage: boolean }) {
  const [plugins, setPlugins] = useState<PluginDto[]>(initialPlugins);
  const [isOpen, setIsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [manifestText, setManifestText] = useState(EXAMPLE_MANIFEST);

  function upsertLocal(plugin: PluginDto) {
    setPlugins((current) => {
      const exists = current.some((item) => item.id === plugin.id);
      return exists ? current.map((item) => (item.id === plugin.id ? plugin : item)) : [plugin, ...current];
    });
  }

  async function onInstall() {
    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      toast.error('Manifest must be valid JSON.');
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/plugins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(manifest),
      });
      const result = (await response.json()) as ApiResponse<PluginDto>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      upsertLocal(result.data);
      toast.success('Plugin installed.');
      setIsOpen(false);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(plugin: PluginDto) {
    setPendingId(plugin.id);
    const action = plugin.status === 'ENABLED' ? 'disable' : 'enable';
    try {
      const response = await fetch(`/api/plugins/${plugin.id}/${action}`, { method: 'POST' });
      const result = (await response.json()) as ApiResponse<PluginDto>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      upsertLocal(result.data);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setPendingId(null);
    }
  }

  async function onUninstall(id: string) {
    setPendingId(id);
    try {
      const response = await fetch(`/api/plugins/${id}`, { method: 'DELETE' });
      const result = (await response.json()) as ApiResponse<{ id: string }>;
      if (!result.success) {
        toast.error(result.error.message);
        return;
      }
      setPlugins((current) => current.filter((plugin) => plugin.id !== id));
      toast.success('Plugin uninstalled.');
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
          <h2 className="text-lg font-semibold">Plugins</h2>
          <p className="text-sm text-muted-foreground">
            Install validated, permission-scoped extensions. Plugins run out-of-process and are sandboxed to the scopes
            they request.
          </p>
        </div>
        {canManage && (
          <Modal open={isOpen} onOpenChange={setIsOpen}>
            <ModalTrigger asChild>
              <Button>Install plugin</Button>
            </ModalTrigger>
            <ModalContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
              <ModalHeader>
                <ModalTitle>Install plugin</ModalTitle>
                <ModalDescription>Paste a plugin manifest. It is validated before install.</ModalDescription>
              </ModalHeader>
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Manifests may only request known API scopes, must namespace routes under{' '}
                    <code>/plugins/&lt;id&gt;/</code>, and cannot contain executable code.
                  </span>
                </div>
                <div className="space-y-1.5">
                  <Label>Manifest (JSON)</Label>
                  <Textarea
                    rows={14}
                    className="font-mono text-xs"
                    value={manifestText}
                    onChange={(event) => setManifestText(event.target.value)}
                  />
                </div>
              </div>
              <ModalFooter>
                <Button onClick={onInstall} disabled={submitting}>
                  {submitting ? 'Installing…' : 'Install'}
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        )}
      </div>

      {plugins.length === 0 ? (
        <EmptyState icon={Puzzle} title="No plugins installed" description="Install a plugin from a manifest to extend BOND OS." />
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Plugin</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Extends</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {plugins.map((plugin) => (
                <TableRow key={plugin.id}>
                  <TableCell>
                    <p className="text-sm font-medium">
                      {plugin.name} <span className="text-xs font-normal text-muted-foreground">v{plugin.version}</span>
                    </p>
                    {plugin.description && <p className="max-w-md truncate text-xs text-muted-foreground">{plugin.description}</p>}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {plugin.grantedScopes.slice(0, 3).map((scope) => (
                        <Badge key={scope} variant="outline" className="text-[10px]">
                          {scope}
                        </Badge>
                      ))}
                      {plugin.grantedScopes.length > 3 && (
                        <Badge variant="outline" className="text-[10px]">
                          +{plugin.grantedScopes.length - 3}
                        </Badge>
                      )}
                      {plugin.grantedScopes.length === 0 && <span className="text-xs text-muted-foreground">None</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {plugin.components.length} component{plugin.components.length === 1 ? '' : 's'} · {plugin.hooks.length} hook
                    {plugin.hooks.length === 1 ? '' : 's'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[plugin.status]}>{plugin.status}</Badge>
                  </TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" disabled={pendingId === plugin.id} onClick={() => toggleStatus(plugin)}>
                          {plugin.status === 'ENABLED' ? 'Disable' : 'Enable'}
                        </Button>
                        <ConfirmDialog
                          trigger={
                            <Button variant="ghost" size="sm" className="text-destructive" disabled={pendingId === plugin.id}>
                              Uninstall
                            </Button>
                          }
                          title={`Uninstall ${plugin.name}?`}
                          description="Its contributions and granted scopes will be removed. This cannot be undone."
                          confirmLabel="Uninstall"
                          onConfirm={() => onUninstall(plugin.id)}
                        />
                      </div>
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
