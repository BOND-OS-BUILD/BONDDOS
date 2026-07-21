# Relationships: Cascade Behavior and Loosely-Typed References

This document explains two things about `packages/database/prisma/schema.prisma`'s 123 `@@index`/`@@unique`
declarations' companion FK constraints: (1) what `onDelete` behavior every real Prisma relation uses and
why, organized as cascade chains from each root; and (2) every place the schema deliberately uses a
**loosely-typed reference (a plain typed column, no `@relation`, no FK constraint)** instead of a normal
Prisma relation, and why.

See [schema.md](./schema.md) for full field lists and [erd.md](./erd.md) for the diagrams these chains
correspond to.

---

## Part 1: onDelete cascade chains

BOND OS has exactly three `onDelete` behaviors in use, plus one relation with no `onDelete` need at all
(non-nullable owning-side relations that are never expected to be deleted independently don't appear —
every actual FK below is one of these three):

- **`Cascade`** — deleting the parent deletes the child row too. Used for ownership: "this row has no
  meaning without its parent."
- **`SetNull`** — deleting the referenced row nulls out the FK on the child, which survives. Used for
  attribution/authorship on rows whose value outlives the actor who touched them.
- **`Restrict`** — deleting the referenced row is blocked by Postgres while children reference it. Used
  five times in the whole schema, always for developer/registry-owned rows that user data points at.

### The root: Organization → Cascade, everywhere

Every organization-scoped model's `organization Organization @relation(fields: [organizationId], ...,
onDelete: Cascade)` means **deleting an `Organization` cascades through nearly the entire schema** —
Membership, Workspace, Project, Task, Document, Meeting, Customer, Email, Entity, Folder, Source,
KnowledgeDocument, Attachment, Contact, Website, Tag, EntityRelationship, Connector, SyncJob, Relationship,
TimelineEvent, Embedding, EmbeddingJob, AiAuditLog, Conversation, Message, OrganizationAiSettings,
ExecutionPlan, ApprovalRequest, ToolExecution, AuditEvent, AgentGoal, Insight, AgentTimelineEvent,
WorkflowDefinition, WorkflowRun, Event, WorkflowSchedule, Comment, Mention, Notification, Space,
ConversationShare, EntityVersionSnapshot all cascade-delete directly. Second-order cascades follow
transitively (e.g. deleting a `Project` cascades to its `Task`s, which cascades to each `Task`'s
`TaskDocument` rows). `Tool` and `Agent` are the schema's only two models with **no** `organizationId` at
all (see [schema.md](./schema.md)) — deleting an `Organization` never touches them, by design, since
they're developer-registered metadata shared across every tenant.

### Company Data chain (Phase 1)

- `Project` → Cascade from `Organization`. `Project.ownerId` → `User`, **SetNull**: deleting the owning
  user doesn't delete the project, it just clears the owner.
- `Task` → Cascade from both `Organization` and `Project` (two independent cascade paths to the same
  row — deleting either deletes the Task). `Task.assigneeId` → `User`, **SetNull**.
- `Document` → Cascade from `Organization`; **Cascade** from `Project`/`Meeting` too (both nullable —
  a Document can exist unattached to either, but if attached, deleting that Project/Meeting deletes the
  Document with it, unlike Task's SetNull-style assignee). `Document.uploadedById` → `User`, **SetNull**.
- `Meeting` → Cascade from `Organization` and `Project`.
- `Customer` → Cascade from `Organization`. `Customer.projects` / `Project.customers`: implicit
  many-to-many (see [Part 3](#part-3-the-implicit-many-to-many-customer--project) below) — Postgres
  enforces `Cascade` on both sides of the hidden `_CustomerToProject` join table, so deleting either a
  Customer or a Project just removes the join row, not the other side.
  `Email.customerId` → `Customer`, **Cascade**; `Email.projectId` → `Project`, **SetNull** (an email's
  customer is essential, its project tag is not).
- `ProjectMember`, `TaskDocument`, `MeetingAttendee` (join tables) → **Cascade** on every FK; a join row
  is meaningless once either side is gone.

### Data Layer chain (Phase 2)

- `Entity` → Cascade from `Organization`. `Entity.creatorId` → `User`, **SetNull**.
- `KnowledgeDocument`, `Contact`, `Website` (the three 1:1 detail tables) → **Cascade** from `Entity`
  (deleting the Entity deletes its detail row — the detail table has no independent existence) *and*
  Cascade from `Organization` directly (belt-and-suspenders, since both point at the same tenant).
  `KnowledgeDocument.folderId`/`sourceId`/`uploadedById` → **SetNull** (a document survives its folder,
  source, or uploader disappearing).
- `Chunk` → Cascade from `KnowledgeDocument` only (no direct `organizationId` — see
  [Part 2](#part-2-models-without-a-direct-organizationid)).
- `Attachment` → Cascade from both `Entity` and `Organization`.
- `Folder` → Cascade from `Organization`; self-referential `parentFolderId` → **Cascade** (deleting a
  folder deletes its subtree, not just the one row — this is the one place a "delete the parent, delete
  the children" cascade is deliberately recursive/self-referential rather than parent-scoped).
  `Folder.createdById` → `User`, **SetNull**.
- `Tag`, `EntityTag` → Cascade throughout (a tag-entity link is meaningless without both sides).
- `EntityRelationship` → Cascade from `Organization` and from both `sourceEntity`/`targetEntity` (deleting
  either endpoint Entity deletes the edge).
- `Connector` → Cascade from `Organization`. `Connector.connectedById` → `User`, **SetNull**.
  `Source.connectorId` → **SetNull** (a manually-uploaded-looking Source survives its Connector being
  disconnected/deleted). `SyncJob.connectorId` → **Cascade** (a sync job has no meaning without its
  connector).

### Knowledge Graph chain (Phase 3)

- `Relationship` → Cascade from `Organization`, and Cascade from both `sourceEntity`/`targetEntity`.
  `Relationship.createdById` → `User`, **SetNull** — doc-comment-adjacent reasoning shared with
  `Conversation.createdById`: *"history survives the actor."*
- `TimelineEvent` → Cascade from `Organization` and `Entity` (append-only log, but still deleted if its
  subject Entity is deleted — there's no value in an orphaned timeline).

### AI Memory chain (Phase 4)

- `Embedding`, `EmbeddingJob`, `AiAuditLog` → Cascade from `Organization` only. None of the three has any
  other real FK — `Embedding`/`EmbeddingJob`'s `sourceId` is a loose reference (Part 2), and
  `AiAuditLog.userId` → `User` is **SetNull**.
- Note the schema comment's own admission: `Embedding` rows are **not** cleaned up when their source
  `Chunk`/`Email`/`Meeting`/`Entity` row is deleted (no cascade path exists to a table `Embedding` doesn't
  have an FK to — see Part 2) — an acknowledged orphan gap, contrasted explicitly against `Comment`'s
  polymorphic references, which *do* get cleaned up via an application-level `deleteCommentsForEntity`
  call wired into every relevant delete service.

### Mr. Bond chain (Phase 5)

- `Conversation` → Cascade from `Organization`. `Conversation.createdById` → `User`, **SetNull** — *"so
  deleting a user doesn't cascade-delete organization conversation history."*
- `Message` → Cascade from `Conversation` and `Organization` (both point at the same tenant).
  `Message.userId` → `User`, **SetNull**.
- `OrganizationAiSettings` → Cascade from `Organization`. `updatedById` → `User`, **SetNull**.

### Execution & Approvals chain (Phase 6)

- `ExecutionPlan` → Cascade from `Organization`. `conversationId` → `Conversation`, **SetNull**;
  `createdById` → `User`, **SetNull**.
- `ApprovalRequest` → Cascade from `ExecutionPlan` (1:1, `planId @unique`) and from `Organization`.
  `approvedById` → `User`, **SetNull**.
- `ToolExecution` → Cascade from `ExecutionPlan` (1:1) and `Organization`. `toolId` → `Tool`, **SetNull**
  (a completed execution's history survives the tool definition being retired). `conversationId` →
  **SetNull**; `createdById` → **SetNull**; `workflowRunStepId` → `WorkflowRunStep`, **SetNull** (the
  Phase 8 bridge — if the originating workflow run step is somehow removed, the execution record itself
  is still worth keeping).
- `ExecutionStep`, `RollbackRecord` → Cascade from `ToolExecution` only (no direct `organizationId` —
  Part 2).
- `AuditEvent` → Cascade from `Organization`. `executionId` → `ToolExecution`, **SetNull** (the
  compliance trail must outlive the execution row it references — audit logs are append-only and must
  never disappear just because the execution they're about got cleaned up). `userId` → `User`, **SetNull**.

### Agent Framework chain (Phase 7)

- `AgentGoal` → Cascade from `Organization`. `agentId` → `Agent`, **Restrict** — one of the schema's five
  `Restrict` FKs (see [Part 4](#part-4-the-five-restrict-fks)). `conversationId`/`createdById` → **SetNull**.
- `GoalStep` → Cascade from `AgentGoal` only.
- `Insight` → Cascade from `Organization`. `agentId` → **Restrict**. `goalId` → `AgentGoal`, **SetNull**
  (an insight survives its originating goal being deleted/completed-and-purged).
- `AgentTimelineEvent` → Cascade from `Organization`. `agentId` → **Restrict**. `conversationId` →
  **SetNull**. `goalId` has **no FK at all** (Part 2).

### Workflow Platform chain (Phase 8)

- `WorkflowDefinition` → Cascade from `Organization`. `ownerId` → `User`, **SetNull**.
- `WorkflowRun` → **Restrict** from `WorkflowDefinition` (the fifth `Restrict` FK) and Cascade from
  `Organization`. `triggerEventId` → `Event`, **SetNull**.
- `WorkflowRunStep` → Cascade from `WorkflowRun` only. Its `planId` is a soft reference (Part 2), and its
  `toolExecution` back-relation has no FK of its own (the FK column lives on `ToolExecution`, see above).
- `Event` → Cascade from `Organization` only; `entityType`/`entityId` are loose (Part 2).
- `WorkflowSchedule` → Cascade from `WorkflowDefinition` (1:1) and `Organization`.
- `WorkflowWebhookDelivery` → Cascade from `WorkflowDefinition` only.

### Enterprise Collaboration chain (Phase 9)

- `Comment` → Cascade from `Organization`. `authorId` → `User`, **Restrict** (the fifth of the five —
  see [Part 4](#part-4-the-five-restrict-fks)). `resolvedById` → `User`, **SetNull**.
  `parentCommentId` (self-relation) → **Cascade** (deleting a comment deletes its replies — a reply has
  no meaning as an orphan). `entityType`/`entityId` are loose (Part 2).
- `CommentAttachment` → Cascade from `Comment` only.
- `Mention` → Cascade from `Organization` and `Comment`. `mentionedUserId` → `User`, **Cascade** (notably
  *not* SetNull — a mention record for a deleted user is deleted outright, unlike most other User FKs in
  this schema, since a mention with no user to notify no longer serves any purpose). `mentionedSpaceId` →
  `Space`, **Cascade**. `mentionedAgentKey` has no FK (Part 2).
- `Notification` → Cascade from `Organization` and `User` (deleting the recipient deletes their
  notifications). `entityType`/`entityId`/`sourceEventId` are loose (Part 2).
- `Space` → Cascade from `Organization`. `createdById` → `User`, **SetNull**.
- `SpaceMember` → Cascade from `Space` and `User`.
- `SpaceProject`/`SpaceKnowledgeDocument`/`SpaceWorkflow`/`SpaceAgent` → Cascade from `Space` only; their
  other id column is a soft reference (Part 2).
- `ConversationShare` → Cascade from `Organization` and `Conversation`. `sharedWithUserId` → `User`,
  **Cascade** (a share with no recipient user is meaningless — mirrors `Mention.mentionedUserId`).
  `sharedById` → `User`, **SetNull** (attribution of *who shared it* survives the sharer's deletion, same
  "history survives the actor" reasoning as `Conversation.createdById`).
- `EntityVersionSnapshot` → Cascade from `Organization`. `editedById` → `User`, **SetNull**.
  `entityType`/`entityId` are loose (Part 2).

---

## Part 2: Models without a direct `organizationId`

Every model above that isn't reachable in one join has its tenant scope enforced through a parent FK's
`organizationId`, never left unscoped. The complete list, each cited against its real parent relation:

| Model | Scoped via | Parent's `organizationId` field |
|---|---|---|
| `ProjectMember` | `projectId` → `Project` | `Project.organizationId` |
| `TaskDocument` | `taskId` → `Task` (also `documentId` → `Document`) | `Task.organizationId` |
| `MeetingAttendee` | `meetingId` → `Meeting` | `Meeting.organizationId` |
| `Chunk` | `knowledgeDocumentId` → `KnowledgeDocument` | `KnowledgeDocument.organizationId` |
| `EntityTag` | `entityId` → `Entity` (also `tagId` → `Tag`) | `Entity.organizationId` |
| `ExecutionStep` | `executionId` → `ToolExecution` | `ToolExecution.organizationId` |
| `RollbackRecord` | `executionId` → `ToolExecution` | `ToolExecution.organizationId` |
| `GoalStep` | `goalId` → `AgentGoal` | `AgentGoal.organizationId` |
| `WorkflowRunStep` | `runId` → `WorkflowRun` | `WorkflowRun.organizationId` |
| `WorkflowWebhookDelivery` | `workflowDefinitionId` → `WorkflowDefinition` | `WorkflowDefinition.organizationId` |
| `CommentAttachment` | `commentId` → `Comment` | `Comment.organizationId` |
| `SpaceMember` | `spaceId` → `Space` | `Space.organizationId` |
| `SpaceProject` / `SpaceKnowledgeDocument` / `SpaceWorkflow` / `SpaceAgent` | `spaceId` → `Space` | `Space.organizationId` |

`Tool` and `Agent` are the two models with **no** organization scope of any kind — they are global,
developer-registered metadata (see [schema.md](./schema.md)).

---

## Part 3: The implicit many-to-many (`Customer` ↔ `Project`)

`Customer.projects Project[]` and `Project.customers Customer[]` declare **no** explicit join model —
neither side has `@relation(fields: ..., references: ...)`. This is Prisma's *implicit* many-to-many
relation: Prisma silently generates a hidden join table, `_CustomerToProject` (columns `A`, `B`, composite
PK, both FKs `onDelete: Cascade`), confirmed in the migration SQL:

```sql
CREATE TABLE "_CustomerToProject" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,
    CONSTRAINT "_CustomerToProject_AB_pkey" PRIMARY KEY ("A","B")
);
CREATE INDEX "_CustomerToProject_B_index" ON "_CustomerToProject"("B");
ALTER TABLE "_CustomerToProject" ADD CONSTRAINT "_CustomerToProject_A_fkey" FOREIGN KEY ("A") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_CustomerToProject" ADD CONSTRAINT "_CustomerToProject_B_fkey" FOREIGN KEY ("B") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

This is the **only** many-to-many in the schema handled this way — every other many-to-many (Entity↔Tag,
Project↔User, Meeting↔User, Space↔User) is modeled explicitly as its own row-bearing join model
(`EntityTag`, `ProjectMember`, `MeetingAttendee`, `SpaceMember`) with its own `id`/`createdAt`/extra
columns. `_CustomerToProject` carries no metadata at all (no "since when," no role) — a plain existence
link, which is exactly what makes the implicit form appropriate here and nowhere else in this schema.

---

## Part 4: The five `Restrict` FKs

`onDelete: Restrict` appears exactly five times in the whole schema — every other FK is `Cascade` or
`SetNull`. All five share the same shape: **user-authored organizational data points at a
developer/registry-owned row, and that row must not silently vanish out from under it.**

1. `AgentGoal.agent` → `Agent`
2. `Insight.agent` → `Agent`
3. `AgentTimelineEvent.agent` → `Agent`
4. `WorkflowRun.workflowDefinition` → `WorkflowDefinition`
5. `Comment.author` → `User`

(1)–(3): `Agent` is developer-registered, global metadata (no `organizationId` — see Part 2/Part 4
context above), synced from the in-memory `AgentRegistry`. A `DELETE FROM agents WHERE id = ...` while any
organization still has goals, insights, or timeline events pointing at that agent is refused by Postgres —
there is no sensible `SetNull` (an orphaned goal with no agent makes no sense) and no sensible `Cascade`
(deleting one org's copy of a shared, cross-tenant registry row would delete every other org's history
too). Restrict forces the registry/deploy process to retire an agent version deliberately rather than as a
side effect.

(4): `WorkflowRun.workflowDefinition` is `Restrict` for the same reason `Tool.executions`'s reverse isn't
even nullable-cascaded — `WorkflowRun` pins the *exact version* of a `WorkflowDefinition` active when it
fired (see the doc comment on `WorkflowRun` in [schema.md](./schema.md)), and a run can be
`WAITING_TIMER` for days. Deleting the definition out from under an in-flight run would strand it with no
way to resume. Restrict means a `WorkflowDefinition` with any run history (even completed) can't be
deleted at all — only disabled (`status = DISABLED`).

(5): `Comment.author` is `Restrict` so a `User` who has ever authored a comment cannot be hard-deleted
while their comments still exist — unlike every other `User` FK in this schema (which uses `SetNull`,
preserving the row but anonymizing the actor), comment authorship is Restrict specifically because
`Comment` has no "deleted user" placeholder concept; the codebase's actual user-removal path is presumably
deactivation (`UserStatus.SUSPENDED`), not a hard `DELETE FROM users`, and Restrict enforces that at the
database level.

---

## Part 5: Loosely-typed references — polymorphic columns with no hard FK

This is the schema's most important recurring design pattern: **a table that must reference rows in
several structurally unrelated tables uses a typed discriminator column plus a plain string id, not a
Prisma relation** — because Prisma (and SQL foreign keys generally) can only point one FK at one target
table, and there is no single target table here. Every instance below is a genuine polymorphic
(one-to-many-tables) reference. A second, related-but-distinct pattern — a single, known target type left
deliberately unenforced — is covered separately in [Part 6](#part-6-a-related-but-distinct-pattern-single-target-soft-references).

### `Embedding.sourceType` / `sourceId` (and `EmbeddingJob`'s identical pair)

`sourceType: EmbeddingSourceType` (`CHUNK` | `NOTE` | `EMAIL` | `MEETING`) + `sourceId: String`. One
`embeddings` table stores vectors for four genuinely unrelated source tables — `Chunk` (document text),
`Entity` (a NOTE's `description`), `Email` (`subject`), `Meeting` (`agenda`+`notes`). A single Prisma
relation field can only reference one model, so a hard FK is structurally impossible without either four
nullable FK columns (one per source table, three always null) or four separate embedding tables. The
schema's own doc comment states the actual reasoning: *"a single embeddings table spanning four unrelated
source tables can't use a normal Prisma relation."* The tradeoff this creates — no cascade-delete when a
`Chunk`/`Email`/`Meeting`/NOTE-`Entity` is deleted — is an accepted, explicitly-acknowledged gap (see
[Part 1](#ai-memory-chain-phase-4) above); every actual read/write of `vector` also bypasses Prisma
entirely (`$queryRaw`/`$executeRaw` in `packages/database/src/repositories/embeddings.ts`), since Prisma
has no native pgvector type either — see [migrations.md](./migrations.md).

### `Event.entityType` / `entityId`

`entityType: String?` + `entityId: String?`, both nullable. Doc comment: *"denormalized from `payload` at
curated `publishEvent()` call sites that concern one entity... What lets the Activity Feed filter by
project/task/entity as a real indexed query instead of a payload-Json scan. Loosely typed (no hard FK) —
matches `entityType`/`entityId`'s own established shape everywhere else it's used in this codebase."*
`Event` is the Event Bus's envelope for *every* domain event in the system (`task.completed`,
`document.uploaded`, agent/workflow/collaboration events, etc.) — its subject can be a `Task`, `Document`,
`Project`, an `Entity`, or nothing at all (a system-level event). A hard FK would need to point at a
different table per `EventSource`, which Prisma can't express, so the pair stays a best-effort,
non-enforced index key rather than a relation.

### `Comment.entityType` / `entityId`

`entityType: CommentableEntityType` (`PROJECT`|`TASK`|`MEETING`|`DOCUMENT`|`CUSTOMER`|`GRAPH_NODE`) +
`entityId: String`. Doc comment: *"matches `Embedding.sourceType`/`sourceId`'s own established precedent
for 'one table spanning genuinely unrelated source tables can't use a normal Prisma relation,' not
`Attachment`'s (which FKs to a single target, `Entity`)."* Six structurally different tables can be
commented on; `GRAPH_NODE` additionally covers `Entity` rows (including `entityType = NOTE`), so even a
`Entity`-only FK wouldn't cover every case. Unlike `Embedding`, this table's orphan risk is explicitly
**not** accepted — `deleteCommentsForEntity` is called from every relevant delete service to clean up a
target entity's comments before/as it's removed, because stale comment threads are reachable through
notification links and are user-visible in a way an orphaned embedding vector never is.

### `Mention.mentionedType` discriminated union

`mentionedType: MentionType` (`USER`|`SPACE`|`AGENT`) alongside **three** optional columns:
`mentionedUserId`/`mentionedSpaceId` (both real, nullable FKs) and `mentionedAgentKey` (a plain string,
no FK — see [Part 6](#part-6-a-related-but-distinct-pattern-single-target-soft-references)). This is a
tagged-union shape rather than the sourceType/sourceId *string*-id pattern above, but it exists for the
same root reason: one `Mention` row can target one of three structurally different tables (`User`,
`Space`) or a non-table concept (`Agent.agentKey`, since `Agent` isn't keyed the same way as everything
else pointing at it — see [Part 6](#part-6-a-related-but-distinct-pattern-single-target-soft-references)).
Only exactly one of the three id fields is populated per row, selected by `mentionedType`; application code,
not a DB constraint, enforces that invariant.

### `EntityVersionSnapshot.entityType` / `entityId`

`entityType: String` (plain `String`, not even an enum — unlike `Comment`'s or `Event`'s) + `entityId:
String`. Doc comment: *"Shared Editing's version history — ONE polymorphic table (mirrors
Event/AuditEvent's own 'one table, not N duplicated ones' precedent), not a separate history table per
Document/Project/Meeting/Entity."* Optimistic-locking `version` was added to `Project`, `Document`,
`Meeting`, and `Entity` (see each model's doc comment in [schema.md](./schema.md)) — four independent
tables that all needed "snapshot the prior state before every versioned overwrite." Rather than four
near-identical snapshot tables (`ProjectVersionSnapshot`, `DocumentVersionSnapshot`, ...), one polymorphic
table does it, with the actual prior row serialized into `snapshot: Json`. `entityType` being a bare
`String` (not a Prisma enum, unlike `Comment.entityType`) reflects that its value-space is exactly the set
of model names carrying `version` — a smaller, more ad hoc set than `Comment`'s deliberately-designed
`CommentableEntityType` enum.

### `Notification.entityType` / `entityId`

Not explicitly named in the schema's own doc comments as an instance of the pattern, but structurally
identical to `Event`'s pair (`entityType: String?`, `entityId: String?`, no relation field) — a
`Notification` can be about a mention, a comment, an approval request, a workflow event, an agent insight,
a task assignment, etc., each with a different underlying subject table, so the same reasoning applies.

### `AuditEvent` — a related but *distinct* case, documented precisely

`AuditEvent` is explicitly called out in this document's brief as one of the polymorphic examples to
explain, but reading the actual model shows it does **not** have `entityType`/`entityId` columns at all.
Its only reference field is `executionId: String?`, a real, nullable, `SetNull` hard FK straight to
`ToolExecution` — because `AuditEvent`'s subject is always, structurally, one `ToolExecution`'s
write-lifecycle (`plan_created`, `approved`, `rejected`, `step_started`, `step_succeeded`, `step_failed`,
`rolled_back`, ...), a single well-known target table, not a set of unrelated ones. Anything more specific
than "which execution" (which step, which tool, which plan) is carried in `metadata: Json?` rather than as
additional typed/FK'd columns — an even *less* structured approach than `Embedding`'s typed
sourceType/sourceId pair, chosen because `AuditEvent`'s own subject granularity varies per `action` string
and isn't worth a fixed column shape. In short: `AuditEvent` illustrates the *absence* of the
sourceType/sourceId pattern where a real single-table FK is sufficient, which is worth documenting
precisely rather than force-fitting it into the polymorphic bucket.

### `AgentTimelineEvent` — also a related but distinct case

Likewise called out in this document's brief; likewise, on inspection, `AgentTimelineEvent` has no
`entityType`/`entityId` pair. It has three real relations (`organization`, `agent` [Restrict],
`conversation` [nullable, SetNull]) plus one genuinely bare, non-relational column: `goalId: String?`,
which has **no** `@relation` and no corresponding back-relation on `AgentGoal` (which only declares
`steps GoalStep[]` and `insights Insight[]` — no `timelineEvents`). This is the single-target soft-reference
pattern (Part 6), not the multi-table polymorphic pattern: `goalId`, when set, always means "an
`AgentGoal.id`," never anything else. Its subject-of-record proper is always one `Agent`'s structured event
stream (`THOUGHT_STARTED`|`RETRIEVAL`|`DELEGATION`|`PLAN`|`APPROVAL_REQUEST`|`EXECUTION`|`COMPLETION`),
captured as an allowlisted DTO in `metadata: Json` — never chain-of-thought text, per the model's own doc
comment.

---

## Part 6: A related but distinct pattern — single-target soft references

Separate from true polymorphism (one column pointing at *several* possible tables), the schema has several
places where a column points at exactly **one** well-known target type but is deliberately left as a plain
string with no FK constraint, because the referencing row is meant to be "resolved at runtime, re-validated
against a live source of truth" rather than database-enforced. The schema's own doc comments name this
precedent explicitly and cross-reference each other:

- **`ExecutionStep.tool: String`** — the toolKey, not an FK to `Tool.id`. Doc comment: *"a step's tool is
  resolved through the plan's own `steps` Json at plan-build time, and re-validated against the live
  registry before it runs."* This is the origin precedent every later soft reference below cites.
- **`WorkflowRunStep.planId: String?`** — soft reference to `ExecutionPlan.id`. Doc comment explicitly:
  *"not a hard FK, matching `ExecutionStep.tool`'s own 'resolved at runtime, re-validated against the live
  source of truth' precedent."*
- **`Space`'s four link models** (`SpaceProject.projectId`, `SpaceKnowledgeDocument.knowledgeDocumentId`,
  `SpaceWorkflow.workflowDefinitionId`, `SpaceAgent.agentKey`) — each model's own doc comment: *"Soft
  reference to `X.id` — see the module doc comment on `Space`,"* and `Space`'s own module comment:
  *"a soft `xxxId: String` reference (no hard FK — mirrors `ExecutionStep.tool`'s... precedent) — a
  Project stays organization-owned; linking it into a Space never moves ownership."* Only `spaceId` on
  each of these four models is a real FK; the other id is unconstrained.
- **`Mention.mentionedAgentKey: String?`** — soft reference to `Agent.agentKey`, used only when
  `mentionedType = AGENT`. Consistent with `SpaceAgent.agentKey`'s own soft reference to the same target.
- **`Notification.sourceEventId: String?`** — a plain string, no relation, pointing at `Event.id` when a
  notification was fanned out from an `Event` via `publishEvent()`.
- **`AgentTimelineEvent.goalId: String?`** — see [Part 5](#agenttimelineevent--also-a-related-but-distinct-case) above.

Why this differs from Part 5's polymorphism: in every case here there is exactly **one** possible target
model per column — a real FK to that one model would be structurally possible. It's omitted anyway,
consistently, for decoupling: `Tool`/`Agent` registry rows and `ExecutionPlan`/`Event` rows are considered
resolved by application-layer lookups (often against a live, in-memory registry, not just the database),
so a hard FK would either be redundant with that revalidation or would wrongly prevent an org from
unlinking/reorganizing a Space without touching the linked row's own lifecycle.

---

## Related documentation

- [schema.md](./schema.md) — full field-by-field reference for every model named above.
- [erd.md](./erd.md) — the Mermaid diagrams these cascade chains and loose references correspond to.
- [migrations.md](./migrations.md) — how these constraints are actually expressed in the one generated
  migration.
- [../vector-search.md](../vector-search.md) — `Embedding`'s polymorphism and pgvector raw-SQL access in
  full.
- [../comments.md](../comments.md) — `Comment`/`Mention`'s polymorphism and the `deleteCommentsForEntity`
  cleanup path.
- [../event-bus.md](../event-bus.md) — `Event.entityType`/`entityId` and the Activity Feed query it enables.
- [../collaboration.md](../collaboration.md), [../spaces.md](../spaces.md) — `EntityVersionSnapshot` and
  `Space`'s soft references in product context.
- [../security/organization-isolation.md](../security/organization-isolation.md) — why `organizationId`
  scoping (Parts 1–2 above) is a security property, not just a data-modeling convenience.
