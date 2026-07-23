# Custom Objects (Phase 11)

## Scope

Custom objects let an organization model its own entities without a schema
change. Definitions get their own tables, but **instances reuse the Knowledge
Graph** `Entity` table — so custom records automatically participate in the
graph, timeline, tags, and search.

- `packages/database/src/repositories/custom-objects.ts` — definitions, fields,
  relationships, and instance CRUD (over `Entity`).
- `apps/web/features/custom-objects/services/custom-object.service.ts` — the
  service.
- `apps/web/app/api/custom-objects/*` — routes.
- Developer → Custom Objects — the no-code builder.

## Data model

A `CustomObjectDefinition` (`organizationId`, `key`, `name`, …) has many
`CustomFieldDefinition` rows. A field has one of ten types (`TEXT`, `NUMBER`,
`EMAIL`, `PHONE`, `SELECT`, `MULTISELECT`, `CHECKBOX`, `DATE`, `RICH_TEXT`,
`FILE`), a `required` flag, and `options` (for select types).

An **instance** is an `Entity` row with `entityType = CUSTOM` and

```json
{ "customObjectKey": "invoice", "values": { "amount": 1200, "status": "open" } }
```

in `metadata`. Every instance query is filtered by `organizationId` **and** the
JSON `customObjectKey`, so records of one object never leak into another.

## Validation

Field values are validated by the shared, pure validator in
`packages/shared/src/custom-fields.ts` (`validateFieldValues`) — the same
validator Dynamic Forms use, so the two stay consistent. Invalid submissions
return `422` with a `key → message` error map.

## Authorization

Defining or altering an object (a schema-level change) is **ADMIN**. Creating
and editing records is **MEMBER**. Deleting an object removes its fields and all
its instance records in one transaction.

## Routes

| Method & path | Role | Purpose |
| --- | --- | --- |
| `GET·POST /api/custom-objects` | MEMBER / ADMIN | List / create definitions |
| `GET·PATCH·DELETE /api/custom-objects/{key}` | MEMBER / ADMIN | Definition detail / update / delete |
| `GET·POST /api/custom-objects/{key}/records` | MEMBER | List / create records |
| `GET·PATCH·DELETE /api/custom-objects/{key}/records/{id}` | MEMBER | Record detail / update / delete |
| `GET /api/custom-objects/{key}/records/export` | MEMBER | CSV export |

The public API exposes read (`custom-objects:read`) and record creation
(`custom-objects:write`) under `/api/v1/custom-objects` (see `docs/public-api.md`).
