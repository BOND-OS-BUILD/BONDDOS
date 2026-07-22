'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, toast } from '@bond-os/ui';

interface FlagRow {
  id: string;
  key: string;
  scope: string;
  scopeId: string | null;
  enabled: boolean;
}
interface Definition {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}

const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export function FeatureFlagManager({
  definitions,
  flags,
}: {
  definitions: readonly Definition[];
  flags: FlagRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const [scope, setScope] = useState('GLOBAL');
  const [scopeId, setScopeId] = useState('');
  const [enabled, setEnabled] = useState(true);

  async function call(method: string, payload: unknown) {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/feature-flags', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as { success: boolean; error?: { message?: string } };
      if (!json.success) throw new Error(json.error?.message ?? 'Request failed.');
      toast.success('Feature flag updated.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  function globalEnabled(flagKey: string): boolean | null {
    const row = flags.find((flag) => flag.scope === 'GLOBAL' && flag.key === flagKey);
    return row ? row.enabled : null;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Known flags — global toggle</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {definitions.map((definition) => {
            const override = globalEnabled(definition.key);
            const effective = override ?? definition.defaultEnabled;
            return (
              <div
                key={definition.key}
                className="flex items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
              >
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {definition.label}
                    {effective ? <Badge variant="success">on</Badge> : <Badge variant="secondary">off</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {definition.description}
                    {override === null ? ` (default: ${definition.defaultEnabled ? 'on' : 'off'})` : ''}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => call('POST', { key: definition.key, scope: 'GLOBAL', enabled: !effective })}
                >
                  {effective ? 'Disable' : 'Enable'}
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add / update an override</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Input placeholder="flag.key" value={key} onChange={(event) => setKey(event.target.value)} />
            <select className={selectClass} value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="GLOBAL">Global</option>
              <option value="ORGANIZATION">Organization</option>
              <option value="USER">User</option>
            </select>
            <Input
              placeholder="scope id (org/user)"
              value={scopeId}
              onChange={(event) => setScopeId(event.target.value)}
              disabled={scope === 'GLOBAL'}
            />
            <select
              className={selectClass}
              value={enabled ? 'on' : 'off'}
              onChange={(event) => setEnabled(event.target.value === 'on')}
            >
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
            <Button
              disabled={busy || !key}
              onClick={() =>
                call('POST', {
                  key,
                  scope,
                  scopeId: scope === 'GLOBAL' ? undefined : scopeId,
                  enabled,
                })
              }
            >
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All overrides</CardTitle>
        </CardHeader>
        <CardContent>
          {flags.length === 0 ? (
            <p className="text-sm text-muted-foreground">No overrides set — all flags use their defaults.</p>
          ) : (
            <div className="space-y-2">
              {flags.map((flag) => (
                <div
                  key={flag.id}
                  className="flex items-center justify-between gap-2 border-b pb-2 text-sm last:border-0 last:pb-0"
                >
                  <span className="font-mono">{flag.key}</span>
                  <span className="text-muted-foreground">
                    {flag.scope}
                    {flag.scopeId ? `:${flag.scopeId}` : ''}
                  </span>
                  {flag.enabled ? <Badge variant="success">on</Badge> : <Badge variant="secondary">off</Badge>}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => call('DELETE', { key: flag.key, scope: flag.scope, scopeId: flag.scopeId ?? undefined })}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
