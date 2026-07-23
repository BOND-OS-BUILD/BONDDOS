# Dynamic Forms (Phase 11)

## Scope

Dynamic forms are validated, no-code field sets that can optionally feed a
custom object: a valid submission to a form with a `customObjectKey` creates a
record of that object.

- `packages/database/src/repositories/forms.ts` — `FormDefinition` persistence
  (the field list lives in the `schema` JSON column).
- `apps/web/features/forms/services/form.service.ts` — the service.
- `apps/web/app/api/forms/*` — routes.
- Developer → Forms — the builder + preview/submit.

## Fields

A form field has the same ten types as custom objects
(`packages/shared/src/custom-fields.ts`) plus `placeholder` and `helpText`.
Because the types are shared, submissions are validated by the same
`validateFieldValues` — a form and the custom object it targets never disagree
on what a value should look like.

## Submission

`POST /api/forms/{key}/submit` (MEMBER):

1. validates `values` against the form's fields (→ `422` with a `key → message`
   map on failure);
2. if the form has a `customObjectKey` and that object still exists, creates a
   custom-object record from the (re-validated, key-filtered) values;
3. returns `{ ok: true, recordId }` — `recordId` is set when a record was
   created, else `null`.

Managing forms (create/update/delete) is **ADMIN**; reading and submitting is
**MEMBER**. A disabled form rejects submissions.

## Routes

| Method & path | Role | Purpose |
| --- | --- | --- |
| `GET·POST /api/forms` | MEMBER / ADMIN | List / create |
| `GET·PATCH·DELETE /api/forms/{key}` | MEMBER / ADMIN | Detail / update / delete |
| `POST /api/forms/{key}/submit` | MEMBER | Validate + (optionally) create a record |

## Rendering

The builder and preview reuse two client components
(`app/(dashboard)/developer/_components`): `FieldsEditor` (define fields) and
`RecordForm` (render inputs per field type). `RecordForm` is the same component
used to enter custom-object records, so form previews behave exactly like the
real thing.
