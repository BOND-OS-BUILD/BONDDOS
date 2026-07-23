# @bond-os/sdk

The official Extension SDK for **BOND OS**. A typed client for the public REST
API, webhook signature verification, and a typed event router — with **zero
runtime dependencies** (it needs only a global `fetch` and Web Crypto, so it
runs in Node 18+, Deno, Bun, browsers, and edge runtimes).

## Install

```bash
npm add @bond-os/sdk
```

## Quick start

```ts
import { createClient } from '@bond-os/sdk';

const bond = createClient({
  apiKey: process.env.BOND_OS_API_KEY!, // a `bond_sk_…` key (Settings → API keys)
  baseUrl: 'https://app.example.com',   // your BOND OS instance
});

// Who am I? (scopes, organization, resource index)
const me = await bond.identity();

// Read collections (paginated)
const { items: projects } = await bond.projects.list({ pageSize: 50, search: 'launch' });
const project = await bond.projects.get(projects[0].id);

// Search, graph, notifications, workflows
const results = await bond.search('quarterly plan');
const analytics = await bond.graph.analytics();
const { items: notifications } = await bond.notifications.list({ read: false });
const { items: workflows } = await bond.workflows.list();

// Custom objects
const objects = await bond.customObjects.list();
const invoices = bond.customObjects.records('invoice');
await invoices.create({ values: { amount: 1200, status: 'open' } });
const { items } = await invoices.list();
```

Every request is scoped to the key's organization and gated by the key's
scopes. Errors surface as `BondApiError` (`code`, `status`, `message`,
`details`).

## Webhooks

Verify inbound webhook requests, then route them to typed handlers:

```ts
import { parseWebhookEvent, createEventRouter, EVENT_TYPES, WEBHOOK_SIGNATURE_HEADER } from '@bond-os/sdk';

const router = createEventRouter();
router.on(EVENT_TYPES.TASK_COMPLETED, (event) => {
  console.log('Task completed:', event.payload);
});
router.on('project.*', (event) => console.log('A project event:', event.type));

// In your HTTP handler:
const rawBody = await request.text();
const event = await parseWebhookEvent({
  secret: process.env.BOND_OS_WEBHOOK_SECRET!,   // the `whsec_…` shown at creation
  body: rawBody,                                 // the exact raw body, not re-serialized
  signatureHeader: request.headers.get(WEBHOOK_SIGNATURE_HEADER),
});
await router.dispatch(event);
```

`parseWebhookEvent` throws on an invalid or stale signature, so a handler only
ever sees authentic events. Use `verifyWebhookSignature` directly if you want a
boolean instead of a throw.

## Escape hatch

Any endpoint not yet wrapped is reachable via `bond.raw`:

```ts
const data = await bond.raw.get('/api/v1/meetings', { pageSize: 10 });
```

## API surface

| Namespace | Methods | Scope |
| --- | --- | --- |
| `bond.projects` | `list`, `get` | `projects:read` |
| `bond.tasks` | `list`, `get` | `tasks:read` |
| `bond.documents` | `list`, `get` | `documents:read` |
| `bond.customers` | `list`, `get` | `customers:read` |
| `bond.meetings` | `list`, `get` | `meetings:read` |
| `bond.search(q)` | — | `search:read` |
| `bond.graph.analytics()` | — | `graph:read` |
| `bond.notifications.list()` | — | `notifications:read` (personal key) |
| `bond.workflows.list()` | — | `workflows:read` |
| `bond.customObjects` | `list`, `records(key).list/create` | `custom-objects:read` / `:write` |
