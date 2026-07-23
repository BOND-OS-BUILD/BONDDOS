# Webhooks (Phase 11)

## Scope

Outbound webhooks deliver signed HTTP callbacks to an organization's endpoints
when events happen. The feature spans:

- `packages/database/src/repositories/webhooks.ts` — `WebhookSubscription` +
  `WebhookDelivery` persistence.
- `apps/web/features/webhooks/lib/signing.ts` — HMAC signing.
- `apps/web/features/webhooks/services/webhook-dispatch.service.ts` — delivery,
  retries, and the fan-out entry point.
- `apps/web/features/webhooks/services/webhook.service.ts` — management (ADMIN).
- `apps/web/app/api/webhooks/*` — management routes.
- Settings → Webhooks (`apps/web/app/(dashboard)/settings/webhooks`) — the UI.

## Subscriptions

A subscription is an org-scoped endpoint (`url`), an event filter (`events`), a
signing `secret`, and an `enabled` flag. The event filter accepts exact types
(`task.completed`), namespace wildcards (`project.*`), or `*` for everything —
matched by `eventMatchesSubscription` from `@bond-os/shared` (see
`docs/events.md` for the catalog). Managing subscriptions requires **ADMIN**;
the signing secret is shown exactly once, at creation.

## Dispatch

`publishEvent()` (the Event Bus) calls `dispatchEventToWebhooks(event)` for
**every** event, wrapped so a slow or failing endpoint can never affect the
publisher, notifications, or workflow dispatch. Dispatch finds the enabled
matching subscriptions, writes a `WebhookDelivery` row per subscription, and
attempts each concurrently with a 3 s timeout.

Each delivery POSTs the event envelope

```json
{ "id": "...", "type": "task.completed", "organizationId": "...", "occurredAt": "...", "payload": { ... } }
```

with headers `X-BondOS-Signature`, `X-BondOS-Event`, and `X-BondOS-Delivery`.

## Signing & verification

The signature is `HMAC-SHA256("<timestamp>.<rawBody>", secret)`, sent as
`X-BondOS-Signature: t=<unix>,v1=<hex>`. Receivers should recompute it over the
**raw** request body and reject signatures older than their tolerance (default 5
minutes). The SDK's `verifyWebhookSignature` / `parseWebhookEvent` do this for
you (`docs/sdk.md`).

## Retries

A failed or timed-out delivery is marked `RETRYING` with an exponential-backoff
`nextRetryAt` (60 s → capped at 6 h), or `FAILED` after 6 attempts. There is no
background worker in this deployment (mirroring `/api/embeddings/jobs/retry`);
due retries are processed by `POST /api/webhooks/process-retries`, triggerable
from the UI ("Process retries") or on a schedule.

## Delivery log & replay

Every attempt is a `WebhookDelivery` row (status, attempts, response status,
error, timestamps). `GET /api/webhooks/{id}/deliveries` lists them; `POST
/api/webhooks/deliveries/{id}/replay` clones a past delivery into a fresh
attempt. Both are surfaced in the Deliveries dialog in the UI.

## Routes

| Method & path | Purpose |
| --- | --- |
| `GET·POST /api/webhooks` | List / create subscriptions |
| `PATCH·DELETE /api/webhooks/{id}` | Update / delete |
| `GET /api/webhooks/{id}/deliveries` | Delivery history |
| `POST /api/webhooks/deliveries/{id}/replay` | Replay a delivery |
| `POST /api/webhooks/process-retries` | Process due retries |
