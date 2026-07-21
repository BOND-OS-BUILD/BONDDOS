# Database Schema Reference

Source of truth: [`packages/database/prisma/schema.prisma`](../../packages/database/prisma/schema.prisma)
(2,308 lines). This document lists **every** Prisma model (67) and **every** enum (46) in the schema,
grouped by the same phase/domain breakdown used in [erd.md](./erd.md), with full field lists, relations,
indexes, unique constraints, table mapping, and — verbatim, where the schema has one — the `///` doc
comment explaining a non-obvious design decision.

For cascade/delete semantics see [relationships.md](./relationships.md). For the Mermaid ER diagrams see
[erd.md](./erd.md). For the migration workflow see [migrations.md](./migrations.md).

**Organization scoping key:** BOND OS is multi-tenant; almost every model carries `organizationId`
directly so `requireRole(organizationId, role)` can authorize a query cheaply without a join (see
[../architecture/overview.md](../architecture/overview.md), [../security/organization-isolation.md](../security/organization-isolation.md)).
Each model below states whether it carries `organizationId` directly, or — for the handful that don't —
exactly how it is scoped instead (always cited against the real parent relation).

---

## Generator / datasource

```prisma
generator client {
  provider        = "prisma-client-js"
  output          = "../src/generated"
  previewFeatures = ["postgresqlExtensions"]
}

datasource db {
  provider   = "postgresql"
  url        = env("DATABASE_URL")
  extensions = [vector]
}
```

Prisma has no native pgvector column type, so `postgresqlExtensions` + `Unsupported("vector(1536)")` is
used for `Embedding.vector` (see [Embedding](#embedding) below and [migrations.md](./migrations.md)).

---

## 1. Auth & Organization (Phase 0)

`User`, `Session`, `Account`, `Verification`, `Organization`, `Membership`, `Workspace`.

> User/Session/Account/Verification match Better Auth's expected Prisma shape (see
> `packages/auth/src/server.ts`) so the Prisma adapter works with zero field-name remapping.
> Organization <-> User is many-to-many via `Membership` (per-org role), so a user can belong to
> multiple organizations.

### User
`@@map("users")`

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| name | String | required |
| email | String | `@unique` |
| emailVerified | Boolean | `@default(false)` |
| image | String? | optional — `@map("avatar")`. Doc comment: *"Avatar URL. Prisma/Better-Auth property is `image`; the API layer exposes it as `avatar`."* |
| firstName | String? | optional |
| lastName | String? | optional |
| title | String? | optional |
| department | String? | optional |
| phone | String? | optional |
| timezone | String? | optional |
| status | UserStatus | `@default(ACTIVE)` |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations (all reverse/collection sides):** `sessions Session[]`, `accounts Account[]`,
`memberships Membership[]`, `ownedProjects Project[] "ProjectOwner"`, `assignedTasks Task[] "TaskAssignee"`,
`uploadedDocuments Document[] "DocumentUploader"`, `projectMemberships ProjectMember[]`,
`meetingAttendances MeetingAttendee[]`, `createdEntities Entity[] "EntityCreator"`, `createdFolders Folder[]`,
`uploadedKnowledgeDocuments KnowledgeDocument[] "KnowledgeDocumentUploader"`, `connectedConnectors Connector[]`,
`createdRelationships Relationship[] "RelationshipCreatedBy"`, `aiAuditLogs AiAuditLog[]`,
`createdConversations Conversation[] "ConversationCreatedBy"`, `messages Message[]`,
`updatedAiSettings OrganizationAiSettings[] "OrganizationAiSettingsUpdatedBy"`,
`createdExecutionPlans ExecutionPlan[] "ExecutionPlanCreatedBy"`,
`approvedApprovalRequests ApprovalRequest[] "ApprovalRequestApprovedBy"`,
`createdToolExecutions ToolExecution[] "ToolExecutionCreatedBy"`, `auditEventsCaused AuditEvent[] "AuditEventUser"`,
`createdAgentGoals AgentGoal[] "AgentGoalCreatedBy"`, `ownedWorkflowDefinitions WorkflowDefinition[] "WorkflowDefinitionOwner"`,
`authoredComments Comment[] "CommentAuthor"`, `resolvedComments Comment[] "CommentResolvedBy"`,
`mentionsOfMe Mention[] "MentionedUser"`, `notifications Notification[]`, `createdSpaces Space[] "SpaceCreatedBy"`,
`spaceMemberships SpaceMember[]`, `sharedConversationsWithMe ConversationShare[] "ConversationShareRecipient"`,
`conversationSharesCreated ConversationShare[] "ConversationShareCreatedBy"`,
`entityVersionSnapshotsEdited EntityVersionSnapshot[] "EntityVersionSnapshotEditedBy"`.

**Indexes/unique:** none besides the implicit unique on `email`.
**Organization scoping:** none directly — `User` is a global identity; org membership is via `Membership`.

### Session
`@@map("sessions")`

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| userId | String | required |
| token | String | `@unique` |
| expiresAt | DateTime | required |
| ipAddress | String? | optional |
| userAgent | String? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`.
**Indexes:** `@@index([userId])`. **Organization scoping:** none — scoped to `User`, which is global.

### Account
`@@map("accounts")`

> Doc comment: *"OAuth accounts and/or the user's hashed credentials (Better Auth stores the password
> hash on the `credential` provider Account row, not on User)."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| userId | String | required |
| accountId | String | required |
| providerId | String | required |
| accessToken | String? | optional |
| refreshToken | String? | optional |
| accessTokenExpiresAt | DateTime? | optional |
| refreshTokenExpiresAt | DateTime? | optional |
| scope | String? | optional |
| idToken | String? | optional |
| password | String? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`.
**Unique:** `@@unique([providerId, accountId])`. **Indexes:** `@@index([userId])`.
**Organization scoping:** none — scoped to `User`.

### Verification
`@@map("verifications")`

> Doc comment: *"Email verification / password reset tokens."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| identifier | String | required |
| value | String | required |
| expiresAt | DateTime | required |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** none — no FK at all. **Indexes:** `@@index([identifier])`.
**Organization scoping:** none — not even user-scoped; looked up by `identifier`/`value` directly.

### Organization
`@@map("organizations")`

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| name | String | required |
| slug | String | `@unique` |
| logo | String? | optional |
| description | String? | optional |
| website | String? | optional |
| industry | String? | optional |
| size | String? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

`description`/`website`/`industry`/`size` are the Phase 1 header comment's point: *"'Company' in the
Phase 1 spec is deliberately not a separate table — its fields were added directly onto Organization... a
parallel Company row redundant."*

**Relations:** the root of the tenancy tree — every other org-scoped model below has a corresponding
`organization Organization[]` reverse relation here (`memberships`, `workspace`, `projects`, `tasks`,
`documents`, `meetings`, `customers`, `emails`, `entities`, `folders`, `sources`, `knowledgeDocuments`,
`attachments`, `contacts`, `websites`, `tags`, `entityRelationships`, `connectors`, `syncJobs`,
`relationships`, `timelineEvents`, `embeddings`, `embeddingJobs`, `aiAuditLogs`, `conversations`,
`messages`, `aiSettings`, `executionPlans`, `approvalRequests`, `toolExecutions`, `auditEvents`,
`agentGoals`, `insights`, `agentTimelineEvents`, `workflowDefinitions`, `workflowRuns`, `events`,
`workflowSchedules`, `comments`, `mentions`, `notifications`, `spaces`, `conversationShares`,
`entityVersionSnapshots`). **Organization scoping:** is the root; N/A.

### Membership
`@@map("memberships")`

> Doc comment: *"Join table linking users to organizations with a per-organization role."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| userId | String | required |
| organizationId | String | required |
| role | Role | `@default(MEMBER)` |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `user User @relation(onDelete: Cascade)`, `organization Organization @relation(onDelete: Cascade)`.
**Unique:** `@@unique([userId, organizationId])`. **Indexes:** `@@index([organizationId])`.
**Organization scoping:** direct (`organizationId`).

### Workspace
`@@map("workspaces")`

> Doc comment: *"Every organization automatically gets exactly one workspace; future AI-facing modules
> (Search, Agents) attach here."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | `@unique` |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`.
**Organization scoping:** direct (`organizationId`, 1:1).

### Enums in this domain
- **Role**: `OWNER`, `ADMIN`, `MEMBER`
- **UserStatus**: `ACTIVE`, `INVITED`, `SUSPENDED`

---

## 2. Company Data (Phase 1)

`Project`, `ProjectMember`, `Task`, `TaskDocument`, `Document`, `Meeting`, `MeetingAttendee`, `Customer`, `Email`.

> Header comment: *"Phase 1 (Knowledge Graph Foundation) adds the structured company memory —
> Project/Task/Document/Meeting/Customer/Email — every one of them keyed directly off `organizationId`
> (not just reachable via a join), which is what lets `requireRole(organizationId, role)` authorize any
> query cheaply."*

### Project
`@@map("projects")`

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| title | String | required |
| description | String? | optional |
| status | ProjectStatus | `@default(PLANNING)` |
| priority | Priority | `@default(MEDIUM)` |
| startDate | DateTime? | optional |
| dueDate | DateTime? | optional |
| ownerId | String? | optional |
| version | Int | `@default(1)`. Doc comment: *"Phase 9, additive — optimistic-locking version for Shared Editing. Every versioned update increments this and snapshots the prior state to `EntityVersionSnapshot`; a caller-supplied stale version fails with `ConflictError` rather than silently overwriting a concurrent edit."* |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`,
`owner User? @relation("ProjectOwner", onDelete: SetNull)`, `tasks Task[]`, `documents Document[]`,
`meetings Meeting[]`, `members ProjectMember[]`, `emails Email[]`, `customers Customer[]` (implicit m:n, see
[relationships.md](./relationships.md)).
**Indexes:** `@@index([organizationId])`, `@@index([ownerId])`.
**Organization scoping:** direct.

### ProjectMember
`@@map("project_members")`

> Doc comment: *"Many-to-many: which users are members of a project."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| projectId | String | required |
| userId | String | required |
| createdAt | DateTime | `@default(now())` |

**Relations:** `project Project @relation(onDelete: Cascade)`, `user User @relation(onDelete: Cascade)`.
**Unique:** `@@unique([projectId, userId])`. **Indexes:** `@@index([userId])`.
**Organization scoping:** none directly — scoped via `projectId` → `Project.organizationId`.

### Task
`@@map("tasks")`

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| projectId | String | required |
| title | String | required |
| description | String? | optional |
| status | TaskStatus | `@default(TODO)` |
| priority | Priority | `@default(MEDIUM)` |
| dueDate | DateTime? | optional |
| completedAt | DateTime? | optional |
| assigneeId | String? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `project Project @relation(onDelete: Cascade)`,
`assignee User? @relation("TaskAssignee", onDelete: SetNull)`, `documents TaskDocument[]`.
**Indexes:** `@@index([organizationId])`, `@@index([projectId])`, `@@index([assigneeId])`.
**Organization scoping:** direct. Note: unlike Project/Document/Meeting, `Task` never gained the Phase 9
optimistic-locking `version` column — a real, undocumented coverage gap noted in
[../architecture/overview.md](../architecture/overview.md).

### TaskDocument
`@@map("task_documents")`

> Doc comment: *"Many-to-many: documents a task references, and the tasks a document supports."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| taskId | String | required |
| documentId | String | required |
| createdAt | DateTime | `@default(now())` |

**Relations:** `task Task @relation(onDelete: Cascade)`, `document Document @relation(onDelete: Cascade)`.
**Unique:** `@@unique([taskId, documentId])`. **Indexes:** `@@index([documentId])`.
**Organization scoping:** none directly — via `taskId`/`documentId`'s own `organizationId`.

### Document
`@@map("documents")`

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| title | String | required |
| description | String? | optional |
| type | DocumentType | `@default(OTHER)` |
| fileName | String | required |
| mimeType | String | required |
| size | Int | required |
| storagePath | String | required |
| projectId | String? | optional |
| meetingId | String? | optional |
| uploadedById | String? | optional |
| version | Int | `@default(1)` — same Phase 9 optimistic-locking note as `Project.version` |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `project Project? @relation(onDelete: Cascade)`,
`meeting Meeting? @relation(onDelete: Cascade)`, `uploadedBy User? @relation("DocumentUploader", onDelete: SetNull)`,
`tasks TaskDocument[]`.
**Indexes:** `@@index([organizationId])`, `@@index([projectId])`, `@@index([meetingId])`, `@@index([uploadedById])`.
**Organization scoping:** direct. This is the Phase 1, project/meeting-scoped file model — deliberately
distinct from Phase 2's `KnowledgeDocument` (see the header comment quoted in the [Data Layer](#3-data-layer--ingestion-phase-2) section).

### Meeting
`@@map("meetings")`

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| projectId | String | required |
| title | String | required |
| agenda | String? | optional |
| notes | String? | optional |
| location | String? | optional |
| meetingDate | DateTime | required |
| duration | Int? | optional — *"Duration in minutes."* |
| version | Int | `@default(1)` — same Phase 9 note as `Project.version` |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `project Project @relation(onDelete: Cascade)`,
`attendees MeetingAttendee[]`, `documents Document[]`.
**Indexes:** `@@index([organizationId])`, `@@index([projectId])`. **Organization scoping:** direct.

### MeetingAttendee
`@@map("meeting_attendees")`

> Doc comment: *"Many-to-many: which users attend a meeting."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| meetingId | String | required |
| userId | String | required |
| createdAt | DateTime | `@default(now())` |

**Relations:** `meeting Meeting @relation(onDelete: Cascade)`, `user User @relation(onDelete: Cascade)`.
**Unique:** `@@unique([meetingId, userId])`. **Indexes:** `@@index([userId])`.
**Organization scoping:** none directly — via `meetingId` → `Meeting.organizationId`.

### Customer
`@@map("customers")`

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| name | String | required |
| company | String? | optional — *"The customer's own company name (an external company, not our tenant Organization)."* |
| email | String? | optional |
| phone | String? | optional |
| website | String? | optional |
| status | CustomerStatus | `@default(LEAD)` |
| notes | String? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `emails Email[]`,
`projects Project[]` (implicit m:n — no join model in Prisma schema; Postgres materializes it as
`_CustomerToProject`, see [relationships.md](./relationships.md)).
**Indexes:** `@@index([organizationId])`. **Organization scoping:** direct.

### Email
`@@map("emails")`

> Doc comment: *"Metadata only — not a Gmail/mail-provider integration. Direction is relative to the
> organization (INCOMING = customer -> us)."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| customerId | String | required |
| projectId | String? | optional |
| subject | String | required |
| sender | String | required |
| recipient | String | required |
| sentAt | DateTime | required |
| direction | EmailDirection | required |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `customer Customer @relation(onDelete: Cascade)`,
`project Project? @relation(onDelete: SetNull)`.
**Indexes:** `@@index([organizationId])`, `@@index([customerId])`, `@@index([projectId])`.
**Organization scoping:** direct.

### Enums in this domain
- **ProjectStatus**: `PLANNING`, `ACTIVE`, `ON_HOLD`, `COMPLETED`, `ARCHIVED`
- **TaskStatus**: `TODO`, `IN_PROGRESS`, `IN_REVIEW`, `DONE`, `CANCELLED`
- **Priority** *(shared by Project and Task)*: `LOW`, `MEDIUM`, `HIGH`, `URGENT`
- **DocumentType**: `PDF`, `DOCX`, `PPT`, `SPREADSHEET`, `NOTE`, `OTHER`
- **CustomerStatus**: `LEAD`, `ACTIVE`, `CHURNED`, `ARCHIVED`
- **EmailDirection**: `INCOMING`, `OUTGOING`

---

## 3. Data Layer / Ingestion (Phase 2)

`Entity`, `Folder`, `Source`, `KnowledgeDocument`, `Chunk`, `Attachment`, `Contact`, `Website`, `Tag`,
`EntityTag`, `EntityRelationship`, `Connector`, `SyncJob`.

See also [../data-layer.md](../data-layer.md) and [../architecture/overview.md](../architecture/overview.md).

> Header comment: *"Phase 2 (Data Layer Foundation) adds the ingestion/indexing layer: a generic `Entity`
> system (+ `KnowledgeDocument`/`Contact`/`Website` detail tables), `Chunk`/`Folder`/`Attachment`/`Source`,
> and `Connector`/`SyncJob` tracking. Phase 2's `KnowledgeDocument` is deliberately NOT named `Document` —
> that name is already Phase 1's project/meeting-scoped file attachment model, which this phase must not
> modify. The two are separate subsystems that happen to both be "documents" conceptually."*

### Entity
`@@map("entities")`

> Doc comment: *"The universal base row every Phase 2 content type shares (title, description, tags,
> metadata, org, creator, timestamps). Type-specific structured fields live on a 1:1 detail table
> (KnowledgeDocument/Contact/Website) referencing `entityId`."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| creatorId | String? | optional |
| entityType | EntityType | required |
| title | String | required |
| description | String? | optional |
| metadata | Json? | optional — *"Free-form type-specific metadata not worth a dedicated column."* |
| version | Int | `@default(1)` — same Phase 9 note as `Project.version`; doc comment adds: *"In practice only exercised for `entityType = NOTE` rows today (the only `Entity` content this codebase lets a user directly edit), but the mechanism is generic to `Entity`."* |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `creator User? @relation("EntityCreator", onDelete: SetNull)`,
`knowledgeDocument KnowledgeDocument?`, `contact Contact?`, `website Website?`, `attachments Attachment[]`,
`tags EntityTag[]`, `outgoingRelationships EntityRelationship[] "EntityRelationshipSource"`,
`incomingRelationships EntityRelationship[] "EntityRelationshipTarget"`,
`outgoingGraphRelationships Relationship[] "RelationshipSource"`,
`incomingGraphRelationships Relationship[] "RelationshipTarget"`, `timelineEvents TimelineEvent[]`.
**Indexes:** `@@index([organizationId])`, `@@index([organizationId, entityType])`.
**Organization scoping:** direct. This is the knowledge graph's node table, reused as-is in Phase 3
(see [4. Knowledge Graph](#4-knowledge-graph-phase-3)).

### Folder
`@@map("folders")`

> Doc comment: *"Organizes KnowledgeDocuments into a folder tree, like a virtual filesystem."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| name | String | required |
| parentFolderId | String? | optional — self-referential |
| createdById | String? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`,
`parentFolder Folder? @relation("FolderChildren", onDelete: Cascade)` (self-relation),
`childFolders Folder[] "FolderChildren"`, `createdBy User? @relation(onDelete: SetNull)`,
`documents KnowledgeDocument[]`.
**Indexes:** `@@index([organizationId])`, `@@index([parentFolderId])`. **Organization scoping:** direct.

### Source
`@@map("sources")`

> Doc comment: *"Where a KnowledgeDocument came from — a manual upload (`connectorId` null) or a
> specific Connector sync."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| connectorId | String? | optional |
| name | String | required |
| externalId | String? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `connector Connector? @relation(onDelete: SetNull)`,
`documents KnowledgeDocument[]`.
**Indexes:** `@@index([organizationId])`, `@@index([connectorId])`. **Organization scoping:** direct.

### KnowledgeDocument
`@@map("knowledge_documents")`

> Doc comment: *"Phase 2's ingestion-layer document — deliberately NOT named `Document` (see the header
> comment). Backs both DOCUMENT- and FILE-type Entities, since a generic uploaded file and a parsed
> document are structurally identical. `parsedText`/`parsedPages`/`parsedMetadata` are populated by
> `@bond-os/parsers`; no embeddings are stored here (see Chunk)."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| entityId | String | `@unique` |
| organizationId | String | required |
| folderId | String? | optional |
| sourceId | String? | optional |
| fileName | String | required |
| mimeType | String | required |
| size | Int | required |
| storagePath | String | required |
| uploadedById | String? | optional |
| parseStatus | ParseStatus | `@default(PENDING)` |
| parsedText | String? | optional |
| parsedPages | Json? | optional — *"Array of per-page extracted text, where the format has pages (e.g. PDF)."* |
| parsedMetadata | Json? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `entity Entity @relation(onDelete: Cascade)`, `organization Organization @relation(onDelete: Cascade)`,
`folder Folder? @relation(onDelete: SetNull)`, `source Source? @relation(onDelete: SetNull)`,
`uploadedBy User? @relation("KnowledgeDocumentUploader", onDelete: SetNull)`, `chunks Chunk[]`.
**Indexes:** `@@index([organizationId])`, `@@index([folderId])`, `@@index([sourceId])`.
**Organization scoping:** direct (also 1:1 to `Entity` via `entityId`).
Full-text search: the hand-appended `knowledge_documents_fts_idx` GIN index covers `parsedText`
(see [migrations.md](./migrations.md)).

### Chunk
`@@map("chunks")`

> Doc comment: *"A structural slice of a KnowledgeDocument's parsed text. No embedding column yet
> ('prepare for vector search later, no embeddings now') — this table's shape is ready for one to be
> added in a future migration. `contentHash` (sha256) lets a future re-sync detect unchanged chunks."*
> (Phase 4 later embeds Chunks via the polymorphic `Embedding` table rather than adding a column here —
> see [5. AI Memory & Retrieval](#5-ai-memory--retrieval-phase-4).)

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| knowledgeDocumentId | String | required |
| chunkType | ChunkType | `@default(PARAGRAPH)` |
| position | Int | required — *"Order within the parent document, zero-based."* |
| content | String | required |
| contentHash | String | required |
| pageNumber | Int? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `knowledgeDocument KnowledgeDocument @relation(onDelete: Cascade)`.
**Indexes:** `@@index([knowledgeDocumentId])`, `@@index([knowledgeDocumentId, position])`.
**Organization scoping:** none directly — via `knowledgeDocumentId` → `KnowledgeDocument.organizationId`.

### Attachment
`@@map("attachments")`

> Doc comment: *"A secondary file attached to any Entity (e.g. an ingested email's attachment) —
> distinct from a KnowledgeDocument, which is itself the primary file content of a DOCUMENT/FILE
> entity."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| entityId | String | required |
| organizationId | String | required |
| fileName | String | required |
| mimeType | String | required |
| size | Int | required |
| storagePath | String | required |
| createdAt | DateTime | `@default(now())` |

**Relations:** `entity Entity @relation(onDelete: Cascade)`, `organization Organization @relation(onDelete: Cascade)`.
**Indexes:** `@@index([entityId])`, `@@index([organizationId])`. **Organization scoping:** direct.

### Contact
`@@map("contacts")`

> Doc comment: *"Detail table for CONTACT-type Entities."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| entityId | String | `@unique` |
| organizationId | String | required |
| name | String | required |
| email | String? | optional |
| phone | String? | optional |
| company | String? | optional |
| jobTitle | String? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `entity Entity @relation(onDelete: Cascade)`, `organization Organization @relation(onDelete: Cascade)`.
**Indexes:** `@@index([organizationId])`. **Organization scoping:** direct (also 1:1 to `Entity`). Also
backs Phase 3's `PERSON` entityType — see the `EntityType` enum comment below.

### Website
`@@map("websites")`

> Doc comment: *"Detail table for WEBSITE-type Entities."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| entityId | String | `@unique` |
| organizationId | String | required |
| url | String | required |
| faviconUrl | String? | optional |
| lastCrawledAt | DateTime? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `entity Entity @relation(onDelete: Cascade)`, `organization Organization @relation(onDelete: Cascade)`.
**Indexes:** `@@index([organizationId])`. **Organization scoping:** direct (also 1:1 to `Entity`).

### Tag
`@@map("tags")`

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| name | String | required |
| color | String? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `entities EntityTag[]`.
**Unique:** `@@unique([organizationId, name])`. **Organization scoping:** direct.

### EntityTag
`@@map("entity_tags")`

> Doc comment: *"Many-to-many: Entity <-> Tag."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| entityId | String | required |
| tagId | String | required |
| createdAt | DateTime | `@default(now())` |

**Relations:** `entity Entity @relation(onDelete: Cascade)`, `tag Tag @relation(onDelete: Cascade)`.
**Unique:** `@@unique([entityId, tagId])`. **Indexes:** `@@index([tagId])`.
**Organization scoping:** none directly — via `entityId`/`tagId`.

### EntityRelationship
`@@map("entity_relationships")`

> Doc comment: *"The generic knowledge-graph edge: any Entity can relate to any other Entity with a
> free-form `relationType` (e.g. 'MENTIONS', 'RELATED_TO'), complementing Phase 1's specific FK-based
> relationships."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| sourceEntityId | String | required |
| targetEntityId | String | required |
| relationType | String | required — free-form, not an enum |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`,
`sourceEntity Entity @relation("EntityRelationshipSource", onDelete: Cascade)`,
`targetEntity Entity @relation("EntityRelationshipTarget", onDelete: Cascade)`.
**Unique:** `@@unique([sourceEntityId, targetEntityId, relationType])`.
**Indexes:** `@@index([organizationId])`, `@@index([targetEntityId])`. **Organization scoping:** direct.
Left alongside Phase 3's typed `Relationship` model rather than retrofitted — see
[4. Knowledge Graph](#4-knowledge-graph-phase-3) and [../knowledge-graph.md](../knowledge-graph.md).

### Connector
`@@map("connectors")`

> Doc comment: *"A per-organization connection to an external provider. `config` is a placeholder for
> future OAuth tokens/settings — no real secrets are stored by this phase (no OAuth flow exists yet)."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| provider | ConnectorProvider | required |
| status | ConnectorStatus | `@default(DISCONNECTED)` |
| config | Json? | optional |
| connectedById | String? | optional |
| lastSyncAt | DateTime? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `connectedBy User? @relation(onDelete: SetNull)`,
`sources Source[]`, `syncJobs SyncJob[]`.
**Unique:** `@@unique([organizationId, provider])`. **Indexes:** `@@index([organizationId])`.
**Organization scoping:** direct.

### SyncJob
`@@map("sync_jobs")`

> Doc comment: *"One row per sync run — history/status/retry tracking. No background worker actually
> executes these yet; rows are created synchronously by a manual 'Sync now' trigger (see
> docs/connectors.md)."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| connectorId | String | required |
| status | SyncJobStatus | `@default(PENDING)` |
| trigger | SyncTrigger | `@default(MANUAL)` |
| startedAt | DateTime | `@default(now())` |
| completedAt | DateTime? | optional |
| itemsProcessed | Int | `@default(0)` |
| itemsFailed | Int | `@default(0)` |
| errorMessage | String? | optional |
| retryCount | Int | `@default(0)` |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `connector Connector @relation(onDelete: Cascade)`.
**Indexes:** `@@index([organizationId])`, `@@index([connectorId])`. **Organization scoping:** direct.
This "one mutable row, status enum, org-scoped `updateMany`" shape is reused verbatim by
`EmbeddingJob` (Phase 4) and `ToolExecution` (Phase 6).

### Enums in this domain
- **EntityType**: `DOCUMENT`, `MEETING`, `NOTE`, `CUSTOMER`, `EMAIL`, `CONTACT`, `WEBSITE`, `FILE`,
  `PERSON`, `COMPANY`, `PROJECT`, `TASK`, `PRODUCT`, `EVENT`. Doc comment (verbatim, key part): *"The
  universal Entity system's type discriminator (Phase 2). MEETING/CUSTOMER/EMAIL/NOTE have no dedicated
  detail table yet... Phase 3 adds PERSON/COMPANY/PROJECT/TASK/PRODUCT/EVENT for the knowledge graph's
  extraction engine. PERSON is deliberately distinct from CONTACT — CONTACT is a Phase 2 manually-added
  contact, PERSON is what Phase 3's extraction engine creates automatically — but both share the
  `Contact` detail table... PROJECT/TASK entities represent mentions extracted from document text, not
  Phase 1's real `Project`/`Task` rows (untouched)."*
- **ParseStatus**: `PENDING`, `PARSED`, `FAILED`, `UNSUPPORTED`
- **ChunkType** — *"No embeddings yet — this just classifies chunk structure."*: `PARAGRAPH`, `HEADING`, `TABLE`, `LIST`, `CODE_BLOCK`
- **ConnectorProvider**: `GOOGLE_DRIVE`, `GMAIL`, `NOTION`, `SLACK`, `GITHUB`, `GOOGLE_CALENDAR`, `ONEDRIVE`
- **ConnectorStatus**: `DISCONNECTED`, `CONNECTED`, `ERROR`, `SYNCING`
- **SyncJobStatus**: `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `RETRYING`
- **SyncTrigger**: `MANUAL`, `SCHEDULED`, `WEBHOOK`, `INCREMENTAL`

---

## 4. Knowledge Graph (Phase 3)

`Relationship`, `TimelineEvent`. See [../knowledge-graph.md](../knowledge-graph.md),
[../knowledge/relationships.md](../knowledge/relationships.md), [../knowledge/timeline.md](../knowledge/timeline.md),
[../knowledge/extraction.md](../knowledge/extraction.md), [../knowledge/resolution.md](../knowledge/resolution.md).

> Header comment: *"Phase 3 (Knowledge Graph) reuses `Entity` as the graph's node table... Edges are a
> new `Relationship` model (typed `relationshipType` + `confidence` + `createdBy`), left alongside Phase
> 2's `EntityRelationship` rather than retrofitting it — `EntityRelationship` still has no real caller,
> so nothing regresses, and `relationType` staying a free-form `String` there isn't touched."*
>
> Deterministic graph edges, timeline, and the extraction/resolution engine that populates them. No
> AI/embeddings/LLMs — rule-based only.

### Relationship
`@@map("relationships")`

> Doc comment: *"The knowledge graph's typed edge table. Deliberately a new model, not a retrofit of
> Phase 2's `EntityRelationship`... `confidence` lets deterministic-but-fuzzy detections (e.g.
> proximity-based WORKS_AT) be distinguished from certain ones (e.g. an exact document mention) without
> any ML."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| sourceEntityId | String | required |
| targetEntityId | String | required |
| relationshipType | RelationshipType | required |
| confidence | Float | `@default(1.0)` — *"1.0 for deterministic/certain detections; lower for heuristic ones (e.g. proximity-based WORKS_AT)."* |
| createdById | String? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`,
`sourceEntity Entity @relation("RelationshipSource", onDelete: Cascade)`,
`targetEntity Entity @relation("RelationshipTarget", onDelete: Cascade)`,
`createdBy User? @relation("RelationshipCreatedBy", onDelete: SetNull)`.
**Unique:** `@@unique([sourceEntityId, targetEntityId, relationshipType])`.
**Indexes:** `@@index([organizationId])`, `@@index([sourceEntityId])`, `@@index([targetEntityId])`.
**Organization scoping:** direct.

### TimelineEvent
`@@map("timeline_events")`

> Doc comment: *"Every Entity's chronological activity feed. Append-only."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| entityId | String | required |
| eventType | TimelineEventType | required |
| description | String | required |
| metadata | Json? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `entity Entity @relation(onDelete: Cascade)`.
**Indexes:** `@@index([organizationId])`, `@@index([entityId, createdAt])`. **Organization scoping:** direct.

### Enums in this domain
- **RelationshipType**: `WORKS_AT`, `OWNS`, `CREATED`, `MENTIONED_IN`, `RELATED_TO`, `PART_OF`,
  `BELONGS_TO`, `REPORTS_TO`, `ATTENDED`, `SENT`, `RECEIVED`, `REFERENCES`, `DUPLICATE_OF`, `TAGGED_WITH`,
  `DEPENDS_ON`. Doc comment: *"The 5 relationship types this phase's extraction engine actually detects
  automatically are MENTIONED_IN/RELATED_TO/PART_OF/ATTENDED/WORKS_AT — the rest exist for the manual
  relationship API and future automatic detection... TAGGED_WITH is never stored as a row here — it's
  synthesized at query time from the existing `EntityTag` table, so tagging isn't duplicated."*
- **TimelineEventType**: `CREATED`, `MODIFIED`, `UPLOADED`, `MENTIONED`, `CONNECTED`, `VIEWED`,
  `AI_ACTION`. Doc comment: *"AI_ACTION was reserved in Phase 3 for 'future AI actions' — Phase 4 is that
  future phase: the embedding pipeline appends one AI_ACTION event per document once its chunks are
  embedded."*

---

## 5. AI Memory & Retrieval (Phase 4)

`Embedding`, `EmbeddingJob`, `AiAuditLog`. See [../embeddings.md](../embeddings.md),
[../vector-search.md](../vector-search.md), [../ai-service.md](../ai-service.md), [../retrieval.md](../retrieval.md).

> Header comment: *"Phase 4 (AI Memory & Retrieval) adds pgvector-backed embeddings. Prisma has no
> native vector column type, the same situation `tsvector` was already in (see search.ts) — resolved the
> same way: `postgresqlExtensions` + `Unsupported('vector(N)')`, with actual reads/writes going through
> `$queryRaw`/`$executeRaw`. `Embedding` is deliberately polymorphic (sourceType/sourceId, not a hard FK)
> since it covers four different source tables (Chunk/Entity-as-NOTE/Email/Meeting)... `EmbeddingJob`
> mirrors Phase 2's `SyncJob` (one row per attempt, retryable, no real worker yet). No chat, no agents."*

### Embedding
`@@map("embeddings")`

> Doc comment (verbatim, key parts): *"Polymorphic by design (sourceType/sourceId, not a hard FK) — a
> single embeddings table spanning four unrelated source tables can't use a normal Prisma relation.
> `vector` is `Unsupported` (Prisma has no native pgvector type... it can't be read/written through the
> normal Prisma Client; every actual vector read/write goes through `$queryRaw`/`$executeRaw` in
> `packages/database/src/repositories/embeddings.ts`, which is also where the 'always filter by
> organizationId in the same query' guarantee lives. 1536 is fixed (OpenAI text-embedding-3-small's
> size) because the HNSW index needs one constant dimension."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| sourceType | EmbeddingSourceType | required — polymorphic discriminator, **no relation field** |
| sourceId | String | required — polymorphic target id, **no relation field/FK** |
| content | String | required — *"The exact text that was embedded — kept so citations don't need to re-derive it from the source row."* |
| embeddingModel | String | required |
| embeddingVersion | String | required |
| dimensions | Int | required |
| vector | Unsupported("vector(1536)")? | optional; not accessible via Prisma Client, raw SQL only |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)` only — `sourceType`/`sourceId` are
a loosely-typed reference, **not** a Prisma relation (see [relationships.md](./relationships.md)).
**Unique:** `@@unique([organizationId, sourceType, sourceId])` — doc comment: *"One current embedding per
source — re-embedding upserts (replaces), it never accumulates stale rows from a previous model.
organizationId leads the compound key (not just [sourceType, sourceId]) so the write path is
unconditionally tenant-scoped at the database level too, not only by virtue of every caller happening to
pre-validate sourceId ownership before calling upsertEmbedding."*
**Indexes:** `@@index([organizationId])`, plus the hand-appended `embeddings_vector_hnsw_idx` (see
[migrations.md](./migrations.md)). **Organization scoping:** direct.

### EmbeddingJob
`@@map("embedding_jobs")`

> Doc comment: *"One row per embedding attempt — mirrors Phase 2's `SyncJob` exactly (same retry/history
> shape, same 'no real worker loop yet, triggered manually' honesty). A 'Retry Failed Jobs' service finds
> FAILED rows and re-attempts, incrementing retryCount."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| jobType | EmbeddingJobType | `@default(GENERATE)` |
| sourceType | EmbeddingSourceType | required |
| sourceId | String | required — polymorphic, no relation, same pattern as `Embedding` |
| status | EmbeddingJobStatus | `@default(PENDING)` |
| provider | String? | optional |
| errorMessage | String? | optional |
| retryCount | Int | `@default(0)` |
| startedAt | DateTime? | optional |
| completedAt | DateTime? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)` only.
**Indexes:** `@@index([organizationId])`, `@@index([status])`. **Organization scoping:** direct.

### AiAuditLog
`@@map("ai_audit_logs")`

> Doc comment: *"Audit trail for AI-related requests (retrieval calls, embedding generation) — Security
> §15's 'audit logging for AI requests.' Not tied to one Entity (unlike TimelineEvent), since a search
> request isn't about any single entity. `metadata` also carries lightweight observability data
> (durationMs, resultCount)."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| userId | String? | optional |
| action | String | required |
| provider | String? | optional |
| metadata | Json? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `user User? @relation(onDelete: SetNull)`.
**Indexes:** `@@index([organizationId])`, `@@index([createdAt])`. **Organization scoping:** direct.

### Enums in this domain
- **EmbeddingSourceType**: `CHUNK`, `NOTE`, `EMAIL`, `MEETING`. Doc comment: *"The four source tables
  Phase 4 embeds. CHUNK is the normal case (a KnowledgeDocument may have many); NOTE embeds
  `Entity.description` for entityType=NOTE (Phase 2 gave NOTE no dedicated table, so description is its
  only content); EMAIL embeds `Email.subject` (Phase 1's Email is metadata-only, no body field exists);
  MEETING embeds `Meeting.agenda` + `Meeting.notes`."*
- **EmbeddingJobType**: `GENERATE`, `REINDEX`, `REBUILD`, `DELETE`
- **EmbeddingJobStatus**: `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `RETRYING`

---

## 6. Mr. Bond — Chat & RAG (Phase 5)

`Conversation`, `Message`, `OrganizationAiSettings`. See [../mr-bond.md](../mr-bond.md), [../chat.md](../chat.md),
[../rag.md](../rag.md), [../citations.md](../citations.md).

> Header comment: *"Read-only RAG chat. Every answer goes through Phase 4's Retrieval Layer
> (hybridSearch/buildContext/buildPrompt/AI provider `stream()`) — no autonomous agents, no writes, no
> multi-agent systems."*

### Conversation
`@@map("conversations")`

> Doc comment: *"A chat thread. `createdById` nullable (SetNull) so deleting a user doesn't cascade-delete
> organization conversation history — same 'history survives the actor' reasoning as
> `Relationship.createdBy`/`Folder.createdBy`."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| createdById | String? | optional |
| title | String? | optional |
| pinned | Boolean | `@default(false)` |
| archived | Boolean | `@default(false)` |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`,
`createdBy User? @relation("ConversationCreatedBy", onDelete: SetNull)`, `messages Message[]`,
`executionPlans ExecutionPlan[]`, `toolExecutions ToolExecution[]`, `agentGoals AgentGoal[]`,
`agentTimelineEvents AgentTimelineEvent[]`, `shares ConversationShare[]`.
**Indexes:** `@@index([organizationId])`, `@@index([organizationId, pinned])`, `@@index([organizationId, archived])`.
**Organization scoping:** direct.

### Message
`@@map("messages")`

> Doc comment: *"`organizationId` is denormalized directly onto Message (not just reachable via
> conversationId) — matching Entity/Relationship/TimelineEvent/Embedding's own convention, so
> cost/observability aggregation never needs a join. `userId` is null for ASSISTANT/SYSTEM/TOOL rows
> (only a USER message has an author). `citations`/`metadata`/`tokenUsage` are Json — citations are
> re-resolved via resolveCitationService before being persisted here, so a hallucinated ref never lands
> in this column."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| conversationId | String | required |
| organizationId | String | required |
| userId | String? | optional — null except for USER-role messages |
| role | MessageRole | required |
| content | String | required |
| citations | Json? | optional |
| metadata | Json? | optional |
| tokenUsage | Json? | optional |
| model | String? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `conversation Conversation @relation(onDelete: Cascade)`, `organization Organization @relation(onDelete: Cascade)`,
`user User? @relation(onDelete: SetNull)`.
**Indexes:** `@@index([conversationId, createdAt])`, `@@index([organizationId])`. **Organization scoping:** direct (denormalized).

### OrganizationAiSettings
`@@map("organization_ai_settings")`

> Doc comment: *"One row per organization, every field nullable — unset fields fall back to the existing
> env-var defaults (AI_PROVIDER/AI_MODEL/AI_TEMPERATURE/AI_MAX_TOKENS/CONTEXT_TOKEN_BUDGET), the same
> 'always have a working zero-config default' pattern as Cache/Queue/EmbeddingProvider. Phase 4's `/ai`
> page explicitly deferred a settings UI to 'a future phase' — this is that phase."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | `@unique` |
| provider | String? | optional |
| model | String? | optional |
| temperature | Float? | optional |
| topP | Float? | optional |
| maxTokens | Int? | optional |
| streamingEnabled | Boolean | `@default(true)` |
| contextWindow | Int? | optional |
| retrievalDepth | Int? | optional |
| updatedById | String? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`,
`updatedBy User? @relation("OrganizationAiSettingsUpdatedBy", onDelete: SetNull)`.
**Organization scoping:** direct (1:1).

### Enums in this domain
- **MessageRole**: `SYSTEM`, `USER`, `ASSISTANT`, `TOOL`

---

## 7. Execution & Approvals — Tool Execution Framework (Phase 6)

`Tool`, `ExecutionPlan`, `ApprovalRequest`, `ToolExecution`, `ExecutionStep`, `RollbackRecord`, `AuditEvent`.

See [../tool-execution.md](../tool-execution.md), [../planner.md](../planner.md), [../approvals.md](../approvals.md),
[../rollback.md](../rollback.md), [../workflows/approvals.md](../workflows/approvals.md),
[../security/approvals.md](../security/approvals.md), [../security/audit.md](../security/audit.md).

> Header comment: *"A generic, approval-gated framework so Mr. Bond can propose and — only after explicit
> user approval — execute writes... A Tool's actual BEHAVIOR (validate/preview/execute/rollback) lives in
> code (apps/web/features/tools/), never in the DB — functions aren't storable — the `Tool` model below
> is a queryable metadata snapshot synced from the in-memory registry, not the execution hot path."*

### Tool
`@@map("tools")`

> Doc comment: *"Registered-tool metadata, synced from the in-memory ToolRegistry on first access each
> process lifetime (idempotent upsert by [toolKey, version]). `toolKey` is the stable slug
> ('create_project'); `id` stays a cuid for FK consistency with every other model in this schema. Not
> organization-scoped — a registered tool applies to every organization."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| toolKey | String | required |
| version | String | required |
| name | String | required |
| displayName | String | required |
| description | String | required |
| category | ToolCategory | required |
| icon | String | required |
| minimumRole | Role | required |
| parametersSchema | Json | required |
| outputSchema | Json | required |
| supportsRollback | Boolean | `@default(false)` |
| rollbackSupport | RollbackSupport | `@default(NOT_SUPPORTED)` |
| supportsPreview | Boolean | `@default(true)` |
| supportsDryRun | Boolean | `@default(true)` |
| supportsTransactions | Boolean | `@default(true)` |
| requiresApproval | Boolean | `@default(true)` |
| estimatedExecutionMs | Int | required |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `executions ToolExecution[]`. **Unique:** `@@unique([toolKey, version])`.
**Organization scoping:** **none** — not organization-scoped; a registered tool applies to every organization.

### ExecutionPlan
`@@map("execution_plans")`

> Doc comment: *"A Planner-built, not-yet-approved plan. `steps`/`graph` are Json — see docs/planner.md
> for the exact ExecutionStepDefinition/layer shapes. `planHash` (sha256 of the canonicalized
> steps+params, using @bond-os/parsers' existing `hashContent`) is recomputed at execution time and
> compared — a mismatch hard-fails rather than executing a possibly-tampered plan."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| conversationId | String? | optional |
| createdById | String? | optional |
| summary | String | required |
| steps | Json | required |
| graph | Json | required |
| planHash | String | required |
| estimatedTimeMs | Int | required |
| rollbackStrategy | RollbackSupport | required |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`,
`conversation Conversation? @relation(onDelete: SetNull)`, `createdBy User? @relation("ExecutionPlanCreatedBy", onDelete: SetNull)`,
`approval ApprovalRequest?`, `execution ToolExecution?`.
**Indexes:** `@@index([organizationId])`. **Organization scoping:** direct.

### ApprovalRequest
`@@map("approval_requests")`

> Doc comment: *"The approval gate itself. Single-use/replay protection is an atomic, org-scoped
> conditional `updateMany` (status = PENDING AND not expired -> APPROVED), not a signature... `requiredRole`
> is computed as the max ROLE_HIERARCHY severity across every step's tool in the plan, never
> client-supplied."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| planId | String | `@unique` |
| organizationId | String | required |
| requiredRole | Role | required |
| status | ApprovalStatus | `@default(PENDING)` |
| approvedById | String? | optional |
| approvedAt | DateTime? | optional |
| expiresAt | DateTime | required |
| createdAt | DateTime | `@default(now())` |

**Relations:** `plan ExecutionPlan @relation(onDelete: Cascade)`, `organization Organization @relation(onDelete: Cascade)`,
`approvedBy User? @relation("ApprovalRequestApprovedBy", onDelete: SetNull)`.
**Indexes:** `@@index([organizationId])`, `@@index([status])`. **Organization scoping:** direct (also 1:1 to `ExecutionPlan`).

### ToolExecution
`@@map("tool_executions")`

> Doc comment: *"One row per plan execution attempt — mirrors Phase 2's `SyncJob`/Phase 4's `EmbeddingJob`
> exactly... Not an append-only log — see `AuditEvent` for that. `toolId` is nullable and only set for
> single-step plans — a compound multi-step plan spans several tools, each already identified by its own
> `ExecutionStep.tool` (toolKey); this FK exists for the common single-tool case's convenience, not as the
> source of truth for which tools ran."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| planId | String | `@unique` |
| toolId | String? | optional |
| organizationId | String | required |
| conversationId | String? | optional |
| status | ExecutionStatus | `@default(DRAFT)` |
| startedAt | DateTime? | optional |
| completedAt | DateTime? | optional |
| duration | Int? | optional |
| createdById | String? | optional |
| rollbackStatus | RollbackRecordStatus | `@default(PENDING)` |
| error | String? | optional |
| workflowRunStepId | String? | `@unique` — doc comment: *"Phase 8: set only when this execution was submitted by a Workflow's Invoke-Tool step (via the same `proposeAction()` every other caller uses — no separate write path). How the `/api/execution/[id]/approve` route-layer hook identifies 'resume this WorkflowRun after executing'. Null for every non-workflow execution."* |
| createdAt | DateTime | `@default(now())` |

**Relations:** `plan ExecutionPlan @relation(onDelete: Cascade)`, `tool Tool? @relation(onDelete: SetNull)`,
`organization Organization @relation(onDelete: Cascade)`, `conversation Conversation? @relation(onDelete: SetNull)`,
`createdBy User? @relation("ToolExecutionCreatedBy", onDelete: SetNull)`,
`workflowRunStep WorkflowRunStep? @relation(onDelete: SetNull)`, `steps ExecutionStep[]`,
`rollback RollbackRecord?`, `auditEvents AuditEvent[]`.
**Indexes:** `@@index([organizationId])`, `@@index([status])`. **Organization scoping:** direct.

### ExecutionStep
`@@map("execution_steps")`

> Doc comment: *"One row per DAG step per execution attempt. `tool` stores the toolKey (not an FK) — a
> step's tool is resolved through the plan's own `steps` Json at plan-build time, and re-validated
> against the live registry before it runs; `ExecutionPlan`/`ToolExecution` are the source of truth for a
> step's full definition (params/dependsOn/condition/retry), this row is its runtime status/result."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| executionId | String | required |
| order | Int | required |
| tool | String | required — the toolKey, **not an FK to `Tool`** |
| status | StepStatus | `@default(PENDING)` |
| duration | Int? | optional |
| result | Json? | optional |
| rollback | Json? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `execution ToolExecution @relation(onDelete: Cascade)`.
**Indexes:** `@@index([executionId, order])`. **Organization scoping:** none directly — via `executionId` → `ToolExecution.organizationId`.

### RollbackRecord
`@@map("rollback_records")`

> Doc comment: *"One row per execution's rollback attempt (an execution either never needed one, or has
> exactly one). A failed rollback is recorded, never silently swallowed — partial writes with no
> automatic way back are a real operational alarm, not a state to hide."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| executionId | String | `@unique` |
| status | RollbackRecordStatus | `@default(PENDING)` |
| completedAt | DateTime? | optional |
| details | Json? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `execution ToolExecution @relation(onDelete: Cascade)`.
**Organization scoping:** none directly — via `executionId` → `ToolExecution.organizationId` (1:1).

### AuditEvent
`@@map("audit_events")`

> Doc comment: *"Immutable, append-only — mirrors `TimelineEvent`'s 'never edited or deleted' convention.
> Distinct from Phase 4's `AiAuditLog` (documented fire-and-forget observability for read/generation
> calls); this is the compliance trail for write-lifecycle state transitions (plan_created, approved,
> rejected, step_started, step_succeeded, step_failed, rolled_back, ...)."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| executionId | String? | optional |
| userId | String? | optional |
| action | String | required — free-form lifecycle action string, e.g. `plan_created`, `step_succeeded` |
| metadata | Json? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `execution ToolExecution? @relation(onDelete: SetNull)`,
`user User? @relation("AuditEventUser", onDelete: SetNull)`.
**Indexes:** `@@index([organizationId])`, `@@index([executionId])`. **Organization scoping:** direct.
Note: `AuditEvent` has a real, nullable hard FK to `ToolExecution` — it is **not** an example of the
entityType/entityId polymorphic pattern (it has no such columns); see [relationships.md](./relationships.md)
for the precise distinction.

### Enums in this domain
- **ToolCategory**: `PROJECTS`, `TASKS`, `MEETINGS`, `CUSTOMERS`, `DOCUMENTS`, `NOTES`, `EMAILS`,
  `KNOWLEDGE_GRAPH`, `CRM`, `FILES`, `ANALYTICS`, `SYSTEM`
- **RollbackSupport**: `AUTOMATIC`, `MANUAL`, `NOT_SUPPORTED`
- **ExecutionStatus**: `DRAFT`, `AWAITING_APPROVAL`, `APPROVED`, `REJECTED`, `EXPIRED`, `EXECUTING`,
  `SUCCEEDED`, `FAILED`, `ROLLING_BACK`, `ROLLED_BACK`, `CANCELLED`. Doc comment: *"A single execution's
  overall lifecycle state — DRAFT (plan built, not yet previewed) through the approval gate to a terminal
  SUCCEEDED/FAILED/ROLLED_BACK/CANCELLED. Nothing past AWAITING_APPROVAL is reachable without
  ApprovalService's atomic status transition."*
- **StepStatus**: `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `SKIPPED`, `ROLLED_BACK`
- **ApprovalStatus**: `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED`, `CANCELLED`
- **RollbackRecordStatus**: `PENDING`, `SUCCEEDED`, `FAILED`

---

## 8. Agent Framework — AI Workforce (Phase 7)

`Agent`, `AgentGoal`, `GoalStep`, `Insight`, `AgentTimelineEvent`. See [../agents.md](../agents.md),
[../agents/overview.md](../agents/overview.md), [../base-agent.md](../base-agent.md),
[../agent-registry.md](../agent-registry.md), [../delegation.md](../delegation.md), [../goals.md](../goals.md),
[../insights.md](../insights.md), [../multi-agent.md](../multi-agent.md).

> Header comment: *"Mr. Bond becomes a Coordinator over 5 specialist agents. Every write still flows
> through the unmodified Phase 6 chain (Agent -> Execution Plan -> Approval -> Execution -> Audit) — no
> agent ever calls a Tool's execute() directly; that remains ExecutionService's sole responsibility. Agent
> behavior (the 9 SDK methods) lives in code (apps/web/features/agents/), never in the DB — the `Agent`
> model below is a queryable metadata snapshot, same 'code owns behavior, DB stores metadata' split as
> `Tool`."*

### Agent
`@@map("agents")`

> Doc comment: *"Registered-agent metadata, synced from the in-memory AgentRegistry on first access each
> process lifetime (idempotent upsert by [agentKey, version]) — mirrors `Tool` exactly, including NOT
> being organization-scoped (a registered agent applies to every organization)."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| agentKey | String | required |
| version | String | required |
| name | String | required |
| displayName | String | required |
| description | String | required |
| avatar | String | required |
| category | AgentCategory | required |
| capabilities | Json | required |
| supportedTools | Json | required |
| supportedKnowledge | Json | required |
| priority | Int | `@default(0)` |
| model | String? | optional |
| temperature | Float? | optional |
| maxContext | Int? | optional |
| status | AgentRegistryStatus | `@default(ACTIVE)` |
| minimumRole | Role | `@default(MEMBER)` |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `goals AgentGoal[]`, `insights Insight[]`, `timelineEvents AgentTimelineEvent[]`.
**Unique:** `@@unique([agentKey, version])`. **Organization scoping:** **none** — not organization-scoped, applies globally.

### AgentGoal
`@@map("agent_goals")`

> Doc comment: *"A long-running goal's immutable definition + current status only — mirrors
> `ExecutionPlan`. The actual Plan/Observe/Suggest/Wait/Continue history lives in `GoalStep` (its own
> indexed table), not embedded here as a growing Json array... 'No automatic execution': `lastActivityAt`
> only ever advances from an explicit user action (visiting the goal, an explicit Continue click) —
> nothing in this codebase can set it on a timer."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| agentId | String | required |
| conversationId | String? | optional |
| createdById | String? | optional |
| title | String | required |
| originalPlan | Json | required |
| status | GoalStatus | `@default(ACTIVE)` |
| lastActivityAt | DateTime | `@default(now())` |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `agent Agent @relation(onDelete: Restrict)`,
`conversation Conversation? @relation(onDelete: SetNull)`, `createdBy User? @relation("AgentGoalCreatedBy", onDelete: SetNull)`,
`steps GoalStep[]`, `insights Insight[]`.
**Indexes:** `@@index([organizationId])`, `@@index([organizationId, status])`. **Organization scoping:** direct.
Note `onDelete: Restrict` on `agent` — see [relationships.md](./relationships.md).

### GoalStep
`@@map("goal_steps")`

> Doc comment: *"One row per Plan/Observe/Suggest/Wait/Continue phase actually run for a goal. `output`
> is structured only (same discipline as `AgentTimelineEvent.metadata`) — never a raw prompt/completion
> dump."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| goalId | String | required |
| order | Int | required |
| phase | GoalStepPhase | required |
| output | Json | required |
| triggeredBy | TriggeredBy | `@default(USER)` |
| createdAt | DateTime | `@default(now())` |

**Relations:** `goal AgentGoal @relation(onDelete: Cascade)`.
**Indexes:** `@@index([goalId, order])`. **Organization scoping:** none directly — via `goalId` → `AgentGoal.organizationId`.

### Insight
`@@map("insights")`

> Doc comment: *"An agent's observation, never a data mutation (spec: 'Never modify data'). `status` is
> the one field a user can change directly — it's bookkeeping on the insight itself
> (acknowledge/dismiss), not a write to any domain table, so it does not need to go through the Phase 6
> Plan -> Approval -> Execution chain."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| agentId | String | required |
| goalId | String? | optional |
| type | InsightType | required |
| title | String | required |
| description | String | required |
| relatedEntityIds | Json | required |
| status | InsightStatus | `@default(OPEN)` |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `agent Agent @relation(onDelete: Restrict)`,
`goal AgentGoal? @relation(onDelete: SetNull)`.
**Indexes:** `@@index([organizationId])`, `@@index([organizationId, status])`. **Organization scoping:** direct.

### AgentTimelineEvent
`@@map("agent_timeline_events")`

> Doc comment: *"Immutable, append-only — mirrors `AuditEvent`/`TimelineEvent`'s 'never edited or
> deleted' convention. `metadata` is always an explicit, allowlisted structured DTO per `eventType`
> (built in AgentTimelineService) — deliberately never a raw prompt/completion capture, which is what
> 'never store chain-of-thought' means in practice. Also powers the Delegation Graph UI (query
> eventType=DELEGATION for a conversation) — no separate Delegation table needed."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| agentId | String | required |
| conversationId | String? | optional |
| goalId | String? | optional — **plain column, no `@relation`, no FK** (see [relationships.md](./relationships.md)) |
| eventType | AgentEventType | required |
| metadata | Json | required |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `agent Agent @relation(onDelete: Restrict)`,
`conversation Conversation? @relation(onDelete: SetNull)`. (`goalId` is *not* a relation — see above.)
**Indexes:** `@@index([organizationId])`, `@@index([agentId])`, `@@index([conversationId])`. **Organization scoping:** direct.

### Enums in this domain
- **AgentCategory**: `COORDINATOR`, `PROJECT`, `SALES`, `OPERATIONS`, `KNOWLEDGE`, `FINANCE`
- **AgentRegistryStatus**: `ACTIVE`, `DISABLED`
- **GoalStatus**: `ACTIVE`, `WAITING`, `COMPLETED`, `CANCELLED`
- **GoalStepPhase**: `PLAN`, `OBSERVE`, `SUGGEST`, `WAIT`, `CONTINUE`
- **TriggeredBy**: `USER`, `SYSTEM`. Doc comment: *"SYSTEM is reserved and unused — no worker exists
  anywhere in this codebase to ever set it (confirmed: no cron/scheduler/queue-consumer exists). Same
  'prepare the interface, ship only the working half' pattern already used by `Queue`/`Cache`. Every
  `GoalStep` today is `USER`-triggered."*
- **InsightType**: `RISK`, `MISSING_INFO`, `CONFLICT`, `DUPLICATE`, `RECOMMENDATION`
- **InsightStatus**: `OPEN`, `ACKNOWLEDGED`, `DISMISSED`. Doc comment: *"`OPEN` -> `ACKNOWLEDGED`/`DISMISSED`
  is bookkeeping on the insight row itself, not domain data — it does not go through the Phase 6 approval
  chain."*
- **AgentEventType**: `THOUGHT_STARTED`, `RETRIEVAL`, `DELEGATION`, `PLAN`, `APPROVAL_REQUEST`,
  `EXECUTION`, `COMPLETION`. Doc comment: *"The 7 structured event kinds an agent's Timeline records
  (spec: 'store structured events only, never chain-of-thought')."*

---

## 9. Workflow Automation Platform (Phase 8)

`WorkflowDefinition`, `WorkflowRun`, `WorkflowRunStep`, `Event`, `WorkflowSchedule`, `WorkflowWebhookDelivery`.

See [../workflows.md](../workflows.md), [../workflows/overview.md](../workflows/overview.md),
[../workflows/workflow-engine.md](../workflows/workflow-engine.md), [../event-bus.md](../event-bus.md),
[../workflow-builder.md](../workflow-builder.md), [../scheduling.md](../scheduling.md),
[../retries.md](../retries.md), [../workflow-templates.md](../workflow-templates.md).

> Header comment: *"Event-driven workflows built by organizations via a visual editor, not
> developer-registered code — unlike `Tool`/`Agent`, `WorkflowDefinition` is genuinely org-scoped user
> data (trigger/conditions/graph are all Json). Only the ~10 step-type handlers are developer code (code
> owns behavior for EXECUTING a step; the graph itself is data). Every write a workflow needs still flows
> through the unmodified Phase 6 chain via the same `proposeAction()` every other caller uses — no new
> write path. No background worker exists anywhere in this codebase (confirmed again this phase) —
> scheduling and Wait/Delay-step resumption both go through one externally-triggered tick endpoint, and
> the Event Bus is synchronous/in-process, wrapped so a workflow can never break the write that triggered
> it."*

### WorkflowDefinition
`@@map("workflow_definitions")`

> Doc comment: *"Immutable once published — mirrors `Tool`/`Agent`'s `@@unique([key, version])`
> version-pinning pattern, scoped per-organization here since this is org-authored data, not a
> globally-registered developer artifact. A DRAFT row (unpublished, unreferenced by any real
> `WorkflowRun`) mutates in place — routine visual-builder edits shouldn't churn versions. Publishing
> freezes an ACTIVE, versioned, referenceable row so an in-flight `WorkflowRun` (possibly waiting days on
> a Delay step) always resumes against the exact graph it started with — the same reasoning
> `ExecutionPlan.planHash` is re-verified at execution time for."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| workflowKey | String | required |
| version | String | required |
| name | String | required |
| description | String | required |
| status | WorkflowDefinitionStatus | `@default(DRAFT)` |
| ownerId | String? | optional |
| triggerType | TriggerType | required |
| trigger | Json | required — *"`{type: TriggerType, config: {...}}` — e.g. cron/timezone for SCHEDULED, an entity/source filter for ENTITY_UPDATED. `triggerType` above is a denormalized, indexed copy of `trigger.type` for cheap filtering."* |
| conditions | Json? | optional — *"A `WorkflowConditionNode` tree (AND/OR/NOT/comparison/date/predicate) — null means 'always match the trigger, no further filtering.'"* |
| graph | Json | required — *"A flat DAG via `dependsOn`, the same shape `dag.ts` already operates on for Phase 6 Plan Graphs."* |
| retryPolicy | Json? | optional |
| timeoutMs | Int? | optional |
| rollbackPolicy | Json? | optional |
| webhookSecret | String? | optional — *"Set only when `triggerType = WEBHOOK`. Plaintext at rest, consistent with this codebase's existing posture on integration secrets (e.g. `Account.accessToken`/`refreshToken` are plain columns too) — no field-level encryption utility exists anywhere in this codebase to build against yet."* |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `owner User? @relation("WorkflowDefinitionOwner", onDelete: SetNull)`,
`runs WorkflowRun[]`, `schedule WorkflowSchedule?`, `webhookDeliveries WorkflowWebhookDelivery[]`.
**Unique:** `@@unique([organizationId, workflowKey, version])`.
**Indexes:** `@@index([organizationId])`, `@@index([organizationId, status])`. **Organization scoping:** direct.

### WorkflowRun
`@@map("workflow_runs")`

> Doc comment: *"One row per trigger firing — pins `workflowDefinitionId` to the exact version active at
> trigger time (see the versioning note above)."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| workflowDefinitionId | String | required |
| triggerEventId | String? | optional |
| status | WorkflowRunStatus | `@default(PENDING)` |
| correlationId | String | required — *"Propagates unchanged from the triggering Event through every step this run produces — the tracing id for 'everything that happened because of this one trigger.'"* |
| causationId | String? | optional — *"The triggering Event's own causationId chain, used by the dispatch budget's cycle guard (apps/web/features/workflows/lib/workflow-dispatch-budget.ts) to refuse starting a second run of the SAME WorkflowDefinition within one synchronous dispatch chain."* |
| error | String? | optional |
| startedAt | DateTime | `@default(now())` |
| completedAt | DateTime? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`,
`workflowDefinition WorkflowDefinition @relation(onDelete: Restrict)`, `triggerEvent Event? @relation(onDelete: SetNull)`,
`steps WorkflowRunStep[]`.
**Indexes:** `@@index([organizationId])`, `@@index([organizationId, status])`, `@@index([workflowDefinitionId])`,
`@@index([correlationId])`. **Organization scoping:** direct. Note `onDelete: Restrict` on `workflowDefinition`
— see [relationships.md](./relationships.md).

### WorkflowRunStep
`@@map("workflow_run_steps")`

> Doc comment: *"Mirrors `ExecutionStep`/`GoalStep`'s 'own indexed table for the mutable,
> accumulating-over-time part' precedent — `WorkflowRun` stays a single mostly-static row, this table is
> the per-step runtime history."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| runId | String | required |
| key | String | required |
| stepType | WorkflowStepType | required |
| status | WorkflowStepRunStatus | `@default(PENDING)` |
| input | Json | required |
| output | Json? | optional |
| error | String? | optional |
| attempt | Int | `@default(1)` |
| loopIndex | Int? | optional — *"Set only for a child step materialized by a LOOP step's nested sub-graph iteration."* |
| waitUntil | DateTime? | optional — *"Set only when status = WAITING_TIMER (Wait/Delay steps, and how the tick endpoint finds resumable steps: `WHERE status = WAITING_TIMER AND waitUntil <= now()`)."* |
| planId | String? | optional — *"Soft reference to `ExecutionPlan.id` (not a hard FK, matching `ExecutionStep.tool`'s own 'resolved at runtime, re-validated against the live source of truth' precedent) — set only for an INVOKE_TOOL step once `proposeAction()` returns. `ApprovalRequest`/`ToolExecution` are both already keyed 1:1 by planId, so this alone is enough to look up the full approval/execution state."* — **no relation field/FK to `ExecutionPlan`** |
| startedAt | DateTime? | optional |
| completedAt | DateTime? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `run WorkflowRun @relation(onDelete: Cascade)`, `toolExecution ToolExecution?` (reverse side —
the FK column `workflowRunStepId` actually lives on `ToolExecution`, see [7. Execution & Approvals](#7-execution--approvals--tool-execution-framework-phase-6)).
**Unique:** `@@unique([runId, key])`. **Indexes:** `@@index([status, waitUntil])`.
**Organization scoping:** none directly — via `runId` → `WorkflowRun.organizationId`.

### Event
`@@map("events")`

> Doc comment: *"The Event Bus's append-only envelope — never edited or deleted, same convention as
> `AuditEvent`/`AgentTimelineEvent`. `eventType` is a free-form, dotted string (e.g. 'task.completed',
> 'document.uploaded', 'workflow.notification') rather than a Prisma enum, since the event taxonomy is
> explicitly meant to grow additively over time (spec: 'Extensible') — `source` is the bounded, indexed
> top-level category."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| eventType | String | required — free-form dotted string, not an enum |
| source | EventSource | required |
| payload | Json | required |
| correlationId | String | required |
| causationId | String? | optional |
| metadata | Json? | optional |
| entityType | String? | optional — polymorphic, **no relation field**. Doc comment: *"Phase 9, additive: denormalized from `payload` at curated `publishEvent()` call sites that concern one entity — existing rows are NULL, existing queries unaffected. What lets the Activity Feed filter by project/task/entity as a real indexed query instead of a payload-Json scan. Loosely typed (no hard FK) — matches `entityType`/`entityId`'s own established shape everywhere else it's used in this codebase (`Embedding.sourceType`/`sourceId`, `Comment.entityType`/`entityId`)."* |
| entityId | String? | optional — polymorphic, **no relation field** |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `workflowRuns WorkflowRun[]` (reverse
of `WorkflowRun.triggerEvent`). **Indexes:** `@@index([organizationId, eventType, createdAt])`,
`@@index([correlationId])`, `@@index([organizationId, entityType, entityId, createdAt])`.
**Organization scoping:** direct.

### WorkflowSchedule
`@@map("workflow_schedules")`

> Doc comment: *"Drives the tick endpoint (`POST /api/workflows/schedule/tick`) — one row per
> SCHEDULED-trigger WorkflowDefinition. `nextRunAt` is claimed atomically via a conditional `updateMany`
> (mirrors `ApprovalRequest`'s single-use-enforcement idiom) to prevent double-fire on overlapping tick
> invocations. Queried cross-organization by the tick handler — the one deliberate exception to this
> codebase's 'every service function takes organizationId first' convention, kept in a repository
> function with no organizationId parameter, structurally separate from every other workflow repository
> function."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| workflowDefinitionId | String | `@unique` |
| cronExpression | String | required |
| timezone | String | required |
| nextRunAt | DateTime | required |
| lastRunAt | DateTime? | optional |
| status | WorkflowScheduleStatus | `@default(ACTIVE)` |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`,
`workflowDefinition WorkflowDefinition @relation(onDelete: Cascade)`.
**Indexes:** `@@index([nextRunAt, status])`. **Organization scoping:** direct (also 1:1 to `WorkflowDefinition`).

### WorkflowWebhookDelivery
`@@map("workflow_webhook_deliveries")`

> Doc comment: *"Webhook replay protection — a dedicated table (not folded into `Event`) specifically
> because the uniqueness-as-enforcement idiom needs a real DB constraint, not a soft check, given
> 'Replay protection' and 'Unverified external webhooks' are explicit spec requirements. Mirrors
> `ApprovalRequest`'s atomic-conditional-update idiom, just via a unique constraint instead: a duplicate
> `idempotencyKey` for the same workflow fails the insert outright rather than being caught by
> application logic."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| workflowDefinitionId | String | required |
| idempotencyKey | String | required |
| receivedAt | DateTime | `@default(now())` |

**Relations:** `workflowDefinition WorkflowDefinition @relation(onDelete: Cascade)`.
**Unique:** `@@unique([workflowDefinitionId, idempotencyKey])`.
**Organization scoping:** none directly — via `workflowDefinitionId` → `WorkflowDefinition.organizationId`.

### Enums in this domain
- **WorkflowDefinitionStatus**: `DRAFT`, `ACTIVE`, `DISABLED`
- **WorkflowRunStatus**: `PENDING`, `RUNNING`, `WAITING_APPROVAL`, `WAITING_TIMER`, `COMPLETED`, `FAILED`, `CANCELLED`, `ROLLED_BACK`
- **WorkflowStepType**: `READ_DATA`, `SEARCH_KNOWLEDGE`, `INVOKE_AGENT`, `INVOKE_TOOL`, `WAIT`, `BRANCH`, `DELAY`, `LOOP`, `NOTIFICATION`, `GENERATE_REPORT`
- **WorkflowStepRunStatus**: `PENDING`, `RUNNING`, `WAITING_APPROVAL`, `WAITING_TIMER`, `SUCCEEDED`, `FAILED`, `SKIPPED`, `ROLLED_BACK`
- **EventSource**: `DOCUMENT`, `PROJECT`, `TASK`, `MEETING`, `CUSTOMER`, `EMAIL`, `KNOWLEDGE_GRAPH`,
  `AI_COPILOT`, `AGENT`, `SYSTEM`, `COLLABORATION` (*"Phase 9 — comments, mentions, spaces, shared-conversation
  events."*). Doc comment: *"Mirrors the spec's own Event Bus source list. Deliberately NOT the source of
  the free-form leaf event name — see `Event.eventType`."*
- **TriggerType**: `ENTITY_CREATED`, `ENTITY_UPDATED`, `ENTITY_DELETED`, `FILE_UPLOADED`, `MANUAL`,
  `SCHEDULED`, `WEBHOOK`, `API`, `AGENT_EVENT`, `AI_INSIGHT`
- **WorkflowScheduleStatus**: `ACTIVE`, `PAUSED`

---

## 10. Enterprise Collaboration (Phase 9)

`Comment`, `CommentAttachment`, `Mention`, `Notification`, `Space`, `SpaceMember`, `SpaceProject`,
`SpaceKnowledgeDocument`, `SpaceWorkflow`, `SpaceAgent`, `ConversationShare`, `EntityVersionSnapshot`.

See [../collaboration.md](../collaboration.md), [../presence.md](../presence.md), [../comments.md](../comments.md),
[../notifications.md](../notifications.md), [../activity-feed.md](../activity-feed.md), [../spaces.md](../spaces.md),
[../shared-ai.md](../shared-ai.md).

> Header comment: *"Presence, shared editing, comments, mentions, notifications, an activity feed, team
> spaces, shared AI conversations, and live dashboards — reused on top of the P6 Approval Engine, P7
> Agent Framework, and P8 Event Bus, not parallel infrastructure. No WebSocket/CRDT infra: realtime is a
> reconnecting SSE + Cache-backed poll primitive (apps/web/features/collaboration/), and presence itself
> lives in `Cache` (TTL-based), never a Postgres table — there is no model for it here on purpose."*

### Comment
`@@map("comments")`

> Doc comment: *"Universal comments (spec: attach to Projects/Tasks/Meetings/Documents/Customers/Graph
> nodes). `entityType`/`entityId` are loosely typed (no hard FK) — matches
> `Embedding.sourceType`/`sourceId`'s own established precedent for 'one table spanning genuinely
> unrelated source tables can't use a normal Prisma relation,' not `Attachment`'s (which FKs to a single
> target, `Entity`). `GRAPH_NODE` already covers `Entity` rows including `entityType = NOTE`. Deleting the
> target entity explicitly cleans up its comments via `deleteCommentsForEntity` (wired into every
> relevant delete service) — unlike `Embedding`'s own unaddressed orphan gap, comment threads are
> user-visible enough (reachable from a stale notification link) to need real cleanup."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| entityType | CommentableEntityType | required — polymorphic discriminator, **no relation field** |
| entityId | String | required — polymorphic target id, **no relation field/FK** |
| authorId | String | required |
| parentCommentId | String? | optional — self-referential |
| content | String | required |
| resolved | Boolean | `@default(false)` |
| resolvedById | String? | optional |
| resolvedAt | DateTime? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `author User @relation("CommentAuthor", onDelete: Restrict)`,
`resolvedBy User? @relation("CommentResolvedBy", onDelete: SetNull)`,
`parentComment Comment? @relation("CommentReplies", onDelete: Cascade)` (self-relation), `replies Comment[] "CommentReplies"`,
`attachments CommentAttachment[]`, `mentions Mention[]`.
**Indexes:** `@@index([organizationId])`, `@@index([organizationId, entityType, entityId])`, `@@index([parentCommentId])`.
**Organization scoping:** direct. Note `onDelete: Restrict` on `author` — see [relationships.md](./relationships.md).

### CommentAttachment
`@@map("comment_attachments")`

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| commentId | String | required |
| fileName | String | required |
| mimeType | String | required |
| size | Int | required |
| storagePath | String | required |
| createdAt | DateTime | `@default(now())` |

**Relations:** `comment Comment @relation(onDelete: Cascade)`.
**Indexes:** `@@index([commentId])`. **Organization scoping:** none directly — via `commentId` → `Comment.organizationId`.

### Mention
`@@map("mentions")`

> Doc comment: *"Parsed from `Comment.content` at creation time (a plain `@handle` regex, not an NLP
> step) — a Mention is a structured record, never inferred later from unstructured text, the same
> discipline Phase 7 applied to agent-to-agent messages. `@team` resolves against `Space` membership
> (Spaces ARE this codebase's 'team' concept for mentions). `@agent` mentions are recorded but never
> invoke that agent — they also don't currently fan out a Notification (agents have no inbox and no
> single unambiguous recipient), unlike `@user` mentions."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| commentId | String | required |
| mentionedType | MentionType | required — discriminated union over `USER`/`SPACE`/`AGENT` |
| mentionedUserId | String? | optional — real FK, used when `mentionedType = USER` |
| mentionedSpaceId | String? | optional — real FK, used when `mentionedType = SPACE` |
| mentionedAgentKey | String? | optional — **no relation field**; soft reference to `Agent.agentKey`, used when `mentionedType = AGENT` |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `comment Comment @relation(onDelete: Cascade)`,
`mentionedUser User? @relation("MentionedUser", onDelete: Cascade)`, `mentionedSpace Space? @relation(onDelete: Cascade)`.
(`mentionedAgentKey` is not a relation.)
**Indexes:** `@@index([organizationId])`, `@@index([commentId])`, `@@index([mentionedUserId])`. **Organization scoping:** direct.

### Notification
`@@map("notifications")`

> Doc comment: *"The unified notification model — fanned out from `publishEvent()` (see
> `notification-fanout.service.ts`) plus direct creation for mentions. Read/unread, archive, and snooze
> are all plain columns on this one row, not separate tables — mirrors `ApprovalRequest`'s own 'single
> mutable row, org-scoped updateMany for every state transition' shape."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| userId | String | required |
| type | NotificationType | required |
| title | String | required |
| body | String | required |
| entityType | String? | optional — polymorphic, **no relation field** (same pattern as `Event.entityType`/`entityId`) |
| entityId | String? | optional — polymorphic, **no relation field** |
| sourceEventId | String? | optional — **no relation field**; soft reference to `Event.id` |
| read | Boolean | `@default(false)` |
| readAt | DateTime? | optional |
| archived | Boolean | `@default(false)` |
| snoozedUntil | DateTime? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `user User @relation(onDelete: Cascade)`.
**Indexes:** `@@index([organizationId])`, `@@index([userId, read])`, `@@index([userId, archived])`, `@@index([userId, type])`.
**Organization scoping:** direct.

### Space
`@@map("spaces")`

> Doc comment: *"Team Spaces — curation and grouping, NOT a parallel ACL (see docs/spaces.md: 'Spaces
> group and curate; they do not restrict who can see the underlying content'). `SpaceMember` is a plain
> roster, no space-specific role tier — a member's effective permission is always their ORGANIZATION
> role; space membership requires org membership ('permission inheritance from Organization') and is
> never itself checked as a content-visibility gate. The 4 link models curate a VIEW over existing
> org-owned entities via a soft `xxxId: String` reference (no hard FK — mirrors `ExecutionStep.tool`'s
> 'resolved at runtime, re-validated by the service layer, not the database' precedent) — a Project stays
> organization-owned; linking it into a Space never moves ownership."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| name | String | required |
| description | String? | optional |
| createdById | String? | optional |
| createdAt | DateTime | `@default(now())` |
| updatedAt | DateTime | `@updatedAt` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `createdBy User? @relation("SpaceCreatedBy", onDelete: SetNull)`,
`members SpaceMember[]`, `projects SpaceProject[]`, `documents SpaceKnowledgeDocument[]`, `workflows SpaceWorkflow[]`,
`agents SpaceAgent[]`, `mentions Mention[]`.
**Indexes:** `@@index([organizationId])`. **Organization scoping:** direct.

### SpaceMember
`@@map("space_members")`

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| spaceId | String | required |
| userId | String | required |
| joinedAt | DateTime | `@default(now())` |

**Relations:** `space Space @relation(onDelete: Cascade)`, `user User @relation(onDelete: Cascade)`.
**Unique:** `@@unique([spaceId, userId])`. **Indexes:** `@@index([userId])`.
**Organization scoping:** none directly — via `spaceId` → `Space.organizationId`.

### SpaceProject
`@@map("space_projects")`

> Doc comment: *"Soft reference to `Project.id` — see the module doc comment on `Space`."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| spaceId | String | required |
| projectId | String | required — **no relation field/FK**; soft reference to `Project.id` |
| createdAt | DateTime | `@default(now())` |

**Relations:** `space Space @relation(onDelete: Cascade)` only.
**Unique:** `@@unique([spaceId, projectId])`. **Organization scoping:** none directly — via `spaceId` → `Space.organizationId`.

### SpaceKnowledgeDocument
`@@map("space_knowledge_documents")`

> Doc comment: *"Soft reference to `KnowledgeDocument.id` — see the module doc comment on `Space`."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| spaceId | String | required |
| knowledgeDocumentId | String | required — **no relation field/FK**; soft reference to `KnowledgeDocument.id` |
| createdAt | DateTime | `@default(now())` |

**Relations:** `space Space @relation(onDelete: Cascade)` only.
**Unique:** `@@unique([spaceId, knowledgeDocumentId])`. **Organization scoping:** none directly — via `spaceId`.

### SpaceWorkflow
`@@map("space_workflows")`

> Doc comment: *"Soft reference to `WorkflowDefinition.id` — see the module doc comment on `Space`."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| spaceId | String | required |
| workflowDefinitionId | String | required — **no relation field/FK**; soft reference to `WorkflowDefinition.id` |
| createdAt | DateTime | `@default(now())` |

**Relations:** `space Space @relation(onDelete: Cascade)` only.
**Unique:** `@@unique([spaceId, workflowDefinitionId])`. **Organization scoping:** none directly — via `spaceId`.

### SpaceAgent
`@@map("space_agents")`

> Doc comment: *"Soft reference to `Agent.agentKey` — see the module doc comment on `Space`."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| spaceId | String | required |
| agentKey | String | required — **no relation field/FK**; soft reference to `Agent.agentKey` |
| createdAt | DateTime | `@default(now())` |

**Relations:** `space Space @relation(onDelete: Cascade)` only.
**Unique:** `@@unique([spaceId, agentKey])`. **Organization scoping:** none directly — via `spaceId`.

### ConversationShare
`@@map("conversation_shares")`

> Doc comment: *"Introduces default-private `Conversation` access — a real, in-scope Phase 9 fix. Before
> this model existed, `Conversation` had NO ownership gate: any org member could already read/rename/delete
> any other member's conversation by id (`createdById` was stored but only ever used as an optional list
> filter, never an access check). Sharing is always to a specific org member, never public/cross-organization."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| conversationId | String | required |
| sharedWithUserId | String | required |
| permission | SharePermission | required |
| sharedById | String? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `conversation Conversation @relation(onDelete: Cascade)`,
`sharedWith User @relation("ConversationShareRecipient", onDelete: Cascade)`,
`sharedBy User? @relation("ConversationShareCreatedBy", onDelete: SetNull)`.
**Unique:** `@@unique([conversationId, sharedWithUserId])`. **Indexes:** `@@index([sharedWithUserId])`.
**Organization scoping:** direct.

### EntityVersionSnapshot
`@@map("entity_version_snapshots")`

> Doc comment: *"Shared Editing's version history — ONE polymorphic table (mirrors Event/AuditEvent's own
> 'one table, not N duplicated ones' precedent), not a separate history table per
> Document/Project/Meeting/Entity. A snapshot is written BEFORE every versioned overwrite, so `version -
> 1`'s full prior state is always recoverable. No CRDT, no merge algorithm — a stale-version update
> throws `ConflictError`; the client shows both versions for the user to reconcile manually."*

| Field | Type | Attributes |
|---|---|---|
| id | String | `@id @default(cuid())` |
| organizationId | String | required |
| entityType | String | required — polymorphic discriminator (plain `String`, not an enum), **no relation field** |
| entityId | String | required — polymorphic target id, **no relation field/FK** |
| version | Int | required |
| snapshot | Json | required — the full prior row state |
| editedById | String? | optional |
| createdAt | DateTime | `@default(now())` |

**Relations:** `organization Organization @relation(onDelete: Cascade)`, `editedBy User? @relation("EntityVersionSnapshotEditedBy", onDelete: SetNull)`.
**Indexes:** `@@index([organizationId, entityType, entityId, version])`. **Organization scoping:** direct.

### Enums in this domain
- **CommentableEntityType**: `PROJECT`, `TASK`, `MEETING`, `DOCUMENT`, `CUSTOMER`, `GRAPH_NODE`
- **MentionType**: `USER`, `SPACE`, `AGENT`
- **NotificationType**: `MENTION`, `COMMENT`, `APPROVAL_REQUEST`, `WORKFLOW_EVENT`, `AGENT_INSIGHT`, `TASK_ASSIGNMENT`, `PROJECT_UPDATE`, `MEETING_REMINDER`, `SYSTEM`
- **SharePermission**: `READ`, `COLLABORATE`

---

## Model and enum count

67 models / 46 enums total, matching `packages/database/prisma/schema.prisma` exactly
(verified via `grep -c '^model ' schema.prisma` = 67, `grep -c '^enum ' schema.prisma` = 46):

| Domain | Models | Count |
|---|---|---|
| 1. Auth & Organization | User, Session, Account, Verification, Organization, Membership, Workspace | 7 |
| 2. Company Data | Project, ProjectMember, Task, TaskDocument, Document, Meeting, MeetingAttendee, Customer, Email | 9 |
| 3. Data Layer / Ingestion | Entity, Folder, Source, KnowledgeDocument, Chunk, Attachment, Contact, Website, Tag, EntityTag, EntityRelationship, Connector, SyncJob | 13 |
| 4. Knowledge Graph | Relationship, TimelineEvent | 2 |
| 5. AI Memory & Retrieval | Embedding, EmbeddingJob, AiAuditLog | 3 |
| 6. Mr. Bond (Chat/RAG) | Conversation, Message, OrganizationAiSettings | 3 |
| 7. Execution & Approvals | Tool, ExecutionPlan, ApprovalRequest, ToolExecution, ExecutionStep, RollbackRecord, AuditEvent | 7 |
| 8. Agent Framework | Agent, AgentGoal, GoalStep, Insight, AgentTimelineEvent | 5 |
| 9. Workflow Platform | WorkflowDefinition, WorkflowRun, WorkflowRunStep, Event, WorkflowSchedule, WorkflowWebhookDelivery | 6 |
| 10. Enterprise Collaboration | Comment, CommentAttachment, Mention, Notification, Space, SpaceMember, SpaceProject, SpaceKnowledgeDocument, SpaceWorkflow, SpaceAgent, ConversationShare, EntityVersionSnapshot | 12 |
| **Total** | | **67** |
