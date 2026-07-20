# Connectors & Sync

## Scope

This phase builds the connector **architecture** — a reusable interface, one stub implementation
per provider, and a real sync-job tracking pipeline — with **no OAuth UI and no actual network/API
integration**. Every provider's `connect()`/`sync()` intentionally throws until a real
implementation is written; that's the correct behavior for this phase, not a bug.

## The `Connector` interface (`packages/connectors`)

```ts
interface Connector {
  readonly provider: ConnectorProviderId; // GOOGLE_DRIVE | GMAIL | NOTION | SLACK | GITHUB | GOOGLE_CALENDAR | ONEDRIVE
  connect(config: ConnectorConfig): Promise<void>;
  disconnect(): Promise<void>;
  sync(options: SyncOptions): Promise<SyncResult>;
  status(): Promise<ConnectorStatusInfo>;
  webhook(payload: unknown): Promise<void>;
}
```

`BaseConnector` (`packages/connectors/src/base-connector.ts`) implements the shared scaffolding:
`status()` reflects internal connect/disconnect state, everything else throws
`ConnectorNotImplementedError` — a real, typed error, not a silent no-op. Each provider
(`packages/connectors/src/providers/*.ts`) is a one-line subclass:

```ts
export class GoogleDriveConnector extends BaseConnector {
  readonly provider: ConnectorProviderId = 'GOOGLE_DRIVE';
}
```

`createConnector(provider)` (`packages/connectors/src/registry.ts`) instantiates the right class.
`CONNECTOR_CATALOG` (`packages/connectors/src/catalog.ts`) has UI-facing display names/descriptions
for all 7 providers, decoupled from the connector classes themselves.

**Adding a real provider later**: implement `connect()` (store OAuth tokens — the `Connector.config`
Json column is a placeholder for this), `sync()` (fetch items, create `Entity`+`KnowledgeDocument`
rows via the same repository functions the manual upload path uses — see docs/document-system.md),
and `webhook()` (verify the provider's signature, then behave like an incremental `sync()`). No
other layer needs to change — the `Connector` interface is the seam.

## Data model

- **`Connector`** — one row per (organization, provider): `status` (DISCONNECTED/CONNECTED/ERROR/
  SYNCING), `config` (Json placeholder, no real secrets stored yet), `lastSyncAt`.
- **`Source`** — where a `KnowledgeDocument` came from: a specific `Connector`, or null for a manual
  upload.
- **`SyncJob`** — one row per sync run: `status` (PENDING/RUNNING/SUCCEEDED/FAILED/RETRYING),
  `trigger` (MANUAL/SCHEDULED/WEBHOOK/INCREMENTAL), `startedAt`/`completedAt`,
  `itemsProcessed`/`itemsFailed`, `errorMessage`, `retryCount`. This is the "sync history / last
  sync / retry queue / sync logs" data model the spec asks for.

## The Sync Engine (`apps/web/features/sync/services/sync.service.ts`)

`triggerSyncService(organizationId, connectorId)` is a **real, working** implementation of the
manual-trigger path:

1. Creates a `SyncJob` (status `RUNNING`).
2. Instantiates the connector's stub via `createConnector(provider)` and calls `.sync({trigger:
   'MANUAL'})`.
3. **This throws** (`ConnectorNotImplementedError`) for every provider right now — caught, and
   recorded as `completeSyncJob(..., { status: 'FAILED', errorMessage: error.message })`, with the
   `Connector`'s own status flipped to `ERROR`.
4. Returns the finished job.

Triggering a sync from `/connectors` or `/sync` today will show a `FAILED` job with a "does not
implement sync() yet" message — this is the intended, honest demonstration of the full
history/error-tracking pipeline working end to end, not something to work around. Once a provider's
`sync()` is implemented for real, the exact same code path records `SUCCEEDED` with real
`itemsProcessed`/`itemsFailed` counts, with zero changes to the service, API, or UI.

**Incremental sync / cursors**: `SyncOptions.cursor` and `SyncResult.cursor` are already part of the
`Connector` interface (an opaque string a real implementation would read on entry and return on
exit) — the plumbing is ready, nothing populates it yet since nothing syncs for real.

## No background workers

Every sync in this phase runs synchronously inside the API request that triggers it (there's no job
processor). `getQueue().enqueue('parse-knowledge-document', {...})` (see docs/document-system.md)
is called to demonstrate the queue architecture, but nothing consumes it. `SCHEDULED`/`WEBHOOK`
triggers are represented in `SyncTrigger` but have no scheduler/webhook-receiver behind them yet —
`apps/web/app/api/connectors/[id]/sync/route.ts` is the only thing that currently creates a
`SyncJob`, and it's user-initiated.
