'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, toast } from '@bond-os/ui';

interface Policy {
  id: string;
  scope: string;
  key: string | null;
  limit: number;
  windowSeconds: number;
  enabled: boolean;
}

const SCOPES = ['USER', 'ORGANIZATION', 'API', 'AI', 'TOOL', 'WORKFLOW'];
const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

export function RateLimitManager({ policies }: { policies: Policy[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState('AI');
  const [key, setKey] = useState('');
  const [limit, setLimit] = useState('30');
  const [windowSeconds, setWindowSeconds] = useState('60');

  async function call(method: string, payload: unknown) {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/rate-limits', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = (await response.json()) as { success: boolean; error?: { message?: string } };
      if (!json.success) throw new Error(json.error?.message ?? 'Request failed.');
      toast.success('Rate-limit policy updated.');
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add / update a policy</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <select className={selectClass} value={scope} onChange={(event) => setScope(event.target.value)}>
              {SCOPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <Input placeholder="key (blank = default)" value={key} onChange={(event) => setKey(event.target.value)} />
            <Input type="number" placeholder="limit" value={limit} onChange={(event) => setLimit(event.target.value)} />
            <Input
              type="number"
              placeholder="window (s)"
              value={windowSeconds}
              onChange={(event) => setWindowSeconds(event.target.value)}
            />
            <Button
              disabled={busy || !limit || !windowSeconds}
              onClick={() =>
                call('POST', {
                  scope,
                  key: key || undefined,
                  limit: Number(limit),
                  windowSeconds: Number(windowSeconds),
                  enabled: true,
                })
              }
            >
              Save
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            A blank key sets the scope&apos;s default policy. Scopes: user, organization, api, ai, tool, workflow.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Policies</CardTitle>
        </CardHeader>
        <CardContent>
          {policies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No custom policies — per-scope code defaults and env fallbacks apply.
            </p>
          ) : (
            <div className="space-y-2">
              {policies.map((policy) => (
                <div
                  key={policy.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm last:border-0 last:pb-0"
                >
                  <span className="font-medium">
                    {policy.scope}
                    {policy.key ? `:${policy.key}` : ' (default)'}
                  </span>
                  <span className="text-muted-foreground">
                    {policy.limit} / {policy.windowSeconds}s
                  </span>
                  {policy.enabled ? <Badge variant="success">on</Badge> : <Badge variant="secondary">off</Badge>}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        call('POST', {
                          scope: policy.scope,
                          key: policy.key || undefined,
                          limit: policy.limit,
                          windowSeconds: policy.windowSeconds,
                          enabled: !policy.enabled,
                        })
                      }
                    >
                      {policy.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => call('DELETE', { scope: policy.scope, key: policy.key || undefined })}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
