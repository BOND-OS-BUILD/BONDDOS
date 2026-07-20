# Data Layer (Phase 2)

## Scope

Phase 2 builds the storage, ingestion, and indexing infrastructure future AI features will read
from — a universal entity system, real file storage, document parsing, chunking, a connector
framework, sync-job tracking, and PostgreSQL full-text search. **No AI**: no embeddings, no LLM
calls, no chat, no semantic search — only the plumbing those will eventually sit on. Phase 0
(auth/orgs/dashboard) and Phase 1 (Project/Task/Document/Meeting/Customer/Email) are unmodified.

## Why `KnowledgeDocument`, not `Document`

The Phase 2 spec re-lists entity types Phase 1 already has concrete tables for (Document, Meeting,
Customer, Email) as part of a "Universal Entity System," and separately asks for a Knowledge-
Database model literally called "Document." Both would collide with Phase 1's existing `Document`
model (project/meeting-scoped file attachments) and `/documents` route — which building this phase
without modifying Phase 1 forbids. Resolution:

- Phase 1's `Document`, `/documents`, `/api/documents` are **untouched**.
- Phase 2's ingestion-layer document is named **`KnowledgeDocument`**, living under `/library` and
  `/api/library/*` — a distinct subsystem for uploaded/connector-synced content.
- The "Universal Entity System" is a genuinely new, additive layer (see below), not a retrofit of
  Phase 1's tables. Unified search (which the spec wants to cover both phases' content) is built by
  additively extending Phase 1's existing `/search` page/service with new sections — no Phase 1 file's
  existing behavior changed, only new sections were appended.

## The Entity system

`Entity` (`packages/database/prisma/schema.prisma`) is the universal base row every Phase 2 content
type shares: `organizationId`, `creatorId`, `entityType` (`DOCUMENT`/`MEETING`/`NOTE`/`CUSTOMER`/
`EMAIL`/`CONTACT`/`WEBSITE`/`FILE`), `title`, `description`, `metadata` (Json), timestamps. This is
class-table inheritance, not an EAV blob — matching the codebase's established "typed Prisma models"
convention. Type-specific structured fields live on a 1:1 detail table referencing `entityId`:

- **`KnowledgeDocument`** — file-backed. Also backs `FILE`-type entities (a generic uploaded file
  and a parsed document are structurally identical: fileName/mimeType/size/storagePath/folderId/
  parseStatus/parsedText/parsedPages/parsedMetadata).
- **`Contact`**, **`Website`** — detail tables exist in the schema (ready for future connector
  ingestion) but have no dedicated CRUD UI/API this phase — nothing populates them yet, and neither
  the spec's API nor UI sections named them, so building full CRUD would be speculative scope. Only
  `KnowledgeDocument` (and by extension `FILE`) is fully wired end-to-end this phase.
- `MEETING`/`CUSTOMER`/`EMAIL`/`NOTE` exist in the `EntityType` enum for forward-compatibility (a
  future Gmail/Notion sync would create `Entity` rows of those types) with no detail table yet.

Supporting models: `Folder` (self-referencing, organizes `KnowledgeDocument`s), `Attachment`
(secondary files on any `Entity`), `Tag` + `EntityTag` (many-to-many), and **`EntityRelationship`**
— a generic `sourceEntityId`/`targetEntityId`/`relationType` graph edge, the actual "knowledge
graph" primitive, complementing Phase 1's specific FK-based relationships.

Every new model carries a direct `organizationId`, matching Phase 1's tenancy pattern exactly — so
`requireRole(organizationId, role)` (`packages/auth/src/session.ts`) authorizes any query without a
join, and every service function follows the same shape Phase 1 established: take `organizationId`
explicitly, call `requireRole`, call the repository.

## Layering

Same Repository → Service → API → UI layering Phase 1 established:

- **Repository** (`packages/database/src/repositories/{entities,knowledge-documents,folders,tags,
  sources,connectors,sync-jobs,chunks,search}.ts`) — pure Prisma data access. Org-scoped mutations
  use `updateMany`/`deleteMany` (Prisma's unique-`update` can't combine `id` with a non-unique
  `organizationId` filter), and junction-table replacement only runs if that scoped update actually
  matched a row.
- **Service** (`apps/web/features/{library,connectors,sync}/services/*.ts`) — authorization +
  cross-entity checks (e.g. a `folderId` must belong to the caller's org) + orchestration (upload →
  parse → chunk is one service call, see docs/document-system.md).
- **API** (`apps/web/app/api/library/*`, `/api/connectors/*`, `/api/sync/*`) — thin, wraps every
  handler in `apiHandler(...)`, `assertSameOrigin` on every mutation.
- **UI** (`apps/web/features/{library,connectors,sync}/components/*`, wired into
  `apps/web/app/(dashboard)/{library,connectors,sync}/`).

## What's deliberately not built

Per the spec's explicit exclusions: no AI, chat, embeddings, LLM calls, memory reasoning, agents,
recommendations, or semantic search. No OAuth flows for any connector (architecture only — see
docs/connectors.md). No background workers (see docs/connectors.md's Sync Engine section) — the
`Queue` interface (`packages/shared/src/queue.ts`) is prepared but nothing consumes it yet. No
OCR (images upload and store fine, but aren't parsed — `parseStatus` becomes `UNSUPPORTED`).
