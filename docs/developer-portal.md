# Developer Portal (Phase 11)

## Scope

The Developer portal (`/developer`, in the sidebar as **Developer**) is the
single home for every extensibility surface added in Phase 11. It is a thin,
navigational shell over features documented elsewhere — this doc is the map.

- Shell + nav: `apps/web/app/(dashboard)/developer/layout.tsx`,
  `developer-nav.tsx`.
- Hub: `apps/web/app/(dashboard)/developer/page.tsx`.

## Sections

| Section | Route | Doc |
| --- | --- | --- |
| Portal hub | `/developer` | this doc |
| Custom Objects | `/developer/objects` | `docs/custom-objects.md` |
| Forms | `/developer/forms` | `docs/forms.md` |
| Plugins | `/developer/plugins` | `docs/plugins.md` |
| Templates | `/developer/templates` | this doc + `docs/workflow-templates.md` |
| Automation Builder | `/workflows/builder` | `docs/automation-builder.md` |
| API Reference (Swagger) | `/api/v1/docs` | `docs/public-api.md` |
| OpenAPI spec | `/api/v1/openapi.json` | `docs/public-api.md` |
| API Keys | `/settings/api-keys` | `docs/api-keys.md` |
| Webhooks | `/settings/webhooks` | `docs/webhooks.md` |
| SDK | `packages/sdk` | `docs/sdk.md` |
| GraphQL | `/api/graphql` | `docs/graphql.md` |

## Template marketplace & import/export

Developer → Templates (`app/(dashboard)/developer/templates`) lists templates
visible to the org — its own plus any public ones — across six types
(`WORKFLOW`, `AI_PROMPT`, `PROJECT`, `DOCUMENT`, `KNOWLEDGE_GRAPH_VIEW`,
`DASHBOARD`). Managing templates is ADMIN; browsing and **using** (importing)
them is MEMBER.

- **Use** (`POST /api/templates/{id}/use`) instantiates a live resource where
  that is safe: `WORKFLOW` → a DRAFT workflow definition, `PROJECT` → a project.
  Other types return their content for the client to apply.
- **Export** — a template's JSON is downloadable directly (`GET
  /api/templates/{id}`), and an existing workflow can be packaged as a template
  (`POST /api/templates/export/workflow/{id}`). Export/import round-trips: the
  exported JSON is the same shape `POST /api/templates` accepts.
- **Data export** — `GET /api/export` returns a portable JSON bundle of the
  org's projects, tasks, documents, customers, meetings, and custom objects
  (ADMIN). Custom-object records also export as CSV
  (`GET /api/custom-objects/{key}/records/export`).

## Design principle

Everything under the portal is **additive and reuse-first**: the public API and
GraphQL reuse the dashboard repositories; forms and custom objects share one
validator; automations reuse the Workflow Engine; plugins and webhooks ride the
same event catalog. Nothing here forks core behaviour.
