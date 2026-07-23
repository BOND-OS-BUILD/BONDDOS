# Extension SDK — `@bond-os/sdk` (Phase 11)

## Scope

`packages/sdk` is the official client library for building extensions on BOND
OS. It wraps the public API with a typed client, verifies inbound webhooks, and
routes events to typed handlers. It has **zero runtime dependencies** — it needs
only a global `fetch` and Web Crypto, so it runs in Node 18+, Deno, Bun,
browsers, and edge runtimes.

## Client

`createClient(config)` (`packages/sdk/src/client.ts`) returns a `BondClient`
with a namespace per resource. Each call hits the corresponding `/api/v1`
endpoint through `HttpClient` (`packages/sdk/src/http.ts`), which attaches the
bearer key, serializes query/body, unwraps the `ApiResponse` envelope, and
throws `BondApiError` on failure.

```ts
import { createClient } from '@bond-os/sdk';

const bond = createClient({ apiKey: process.env.BOND_OS_API_KEY!, baseUrl: 'https://app.example.com' });

const me = await bond.identity();
const { items } = await bond.projects.list({ pageSize: 50, search: 'launch' });
const project = await bond.projects.get(items[0].id);
const results = await bond.search('quarterly plan');
await bond.customObjects.records('invoice').create({ values: { amount: 1200 } });
```

Namespaces: `projects`, `tasks`, `documents`, `customers`, `meetings` (each
`list`/`get`), `search(q)`, `graph.analytics()`, `notifications.list()`,
`workflows.list()`, `customObjects` (`list`, `records(key).list/create`), plus
`identity()` and a `raw` escape hatch for any endpoint not yet wrapped.

## Types

`packages/sdk/src/types.ts` exposes `Paginated<T>`, `ListQuery`, `BondApiError`,
and forward-compatible domain shapes (`Project`, `Task`, …) that expose their
well-known fields and allow extra properties, so new API fields never break a
typed client.

## Events

`createEventRouter()` (`packages/sdk/src/events.ts`) registers handlers by
pattern (`*`, `ns.*`, or an exact type from `EVENT_TYPES`) and dispatches a
received envelope to all matching handlers:

```ts
import { createEventRouter, EVENT_TYPES } from '@bond-os/sdk';

const router = createEventRouter();
router.on(EVENT_TYPES.TASK_COMPLETED, (e) => console.log(e.payload));
router.on('project.*', (e) => console.log(e.type));
```

## Webhooks

`packages/sdk/src/webhooks.ts` verifies inbound webhook signatures with
isomorphic Web Crypto (HMAC-SHA256 over `"<timestamp>.<rawBody>"`), rejecting
stale or forged requests:

```ts
import { parseWebhookEvent, WEBHOOK_SIGNATURE_HEADER } from '@bond-os/sdk';

const rawBody = await request.text();
const event = await parseWebhookEvent({
  secret: process.env.BOND_OS_WEBHOOK_SECRET!,
  body: rawBody, // the exact raw body, not re-serialized
  signatureHeader: request.headers.get(WEBHOOK_SIGNATURE_HEADER),
});
await router.dispatch(event);
```

`parseWebhookEvent` throws on an invalid/expired signature, so a handler only
ever sees authentic events. Use `verifyWebhookSignature` for a boolean instead
of a throw.

See `packages/sdk/README.md` for the full API-surface table.
