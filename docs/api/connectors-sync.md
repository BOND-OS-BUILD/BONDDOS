# Connectors & Sync API

`/api/connectors/**` and `/api/sync/**` are fully documented in [System API](./system.md) —
specifically the [Connectors](./system.md#connectors) and [Sync Jobs](./system.md#sync-jobs)
sections, covering all 4 route files:

- `GET /api/connectors` / `POST /api/connectors`
- `DELETE /api/connectors/[id]`
- `POST /api/connectors/[id]/sync`
- `GET /api/sync/jobs`

This file is a pointer, not a duplicate, to avoid documenting the same 4 route files twice across
two documents. See [System API](./system.md) for the full Method/Auth/Params/Request/Response/
Errors/Notes breakdown of each endpoint, including the "every connector provider is a stub"
behavior and the "no background worker — sync only runs when explicitly triggered" caveat that
apply throughout.
