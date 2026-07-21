# Entity-Relationship Diagrams

Ten Mermaid `erDiagram` blocks, one per domain, covering all 67 models in
[`packages/database/prisma/schema.prisma`](../../packages/database/prisma/schema.prisma). Every model's
**full attribute list** appears in exactly one diagram (its "home" domain, matching
[schema.md](./schema.md)'s grouping). Field-level detail, doc comments, indexes, and unique constraints
live in [schema.md](./schema.md); cascade/delete semantics and the polymorphic no-FK patterns are in
[relationships.md](./relationships.md).

## Conventions used below

**Cross-domain references.** Several relations cross a domain boundary (e.g. `Task.assigneeId -> User`,
where `User` lives in domain 1 but `Task` lives in domain 2). Each relationship line is drawn **once**, in
the diagram owned by the model holding the foreign key column. In that diagram, the *other* side of the
relation appears as a bare box with no attributes (Mermaid auto-creates it from the relationship line) —
its full attribute list is in its own home diagram. This keeps every model's full definition in exactly
one place while still making every relation visible somewhere.

**Cardinality notation** (standard Mermaid crow's-foot tokens: `|` = exactly one, `o` = zero, `{` = many):

| Schema shape | Notation | Meaning |
|---|---|---|
| Required FK, `onDelete: Cascade`/`Restrict`/etc. | `Parent \|\|--o{ Child` | Exactly one parent per child; zero-or-many children per parent |
| Optional (nullable) FK, `onDelete: SetNull` | `Parent \|o--o{ Child` | Zero-or-one parent per child; zero-or-many children per parent |
| Required, unique FK (1:1 detail table) | `Parent \|\|--o\| Child` | Exactly one parent per child; zero-or-one child per parent |
| True 1:1 (both required+unique, e.g. Organization/Workspace) | `A \|\|--\|\| B` | Exactly one on both sides |
| Implicit many-to-many (Prisma-generated join table, no explicit model) | `A }o--o{ B` | Zero-or-many on both sides |

**Polymorphic / soft references are never drawn as relationship lines.** Fields like
`Embedding.sourceType`/`sourceId`, `Comment.entityType`/`entityId`, `Event.entityType`/`entityId`,
`Mention.mentionedAgentKey`, `EntityVersionSnapshot.entityType`/`entityId`, and the four `Space*` link
tables' soft `xxxId` columns are **not** Prisma relations — they're plain typed columns with no FK
constraint, spanning multiple unrelated target tables (or deliberately left unenforced). They're listed
as ordinary attributes in the entity box, with a comment, but no relationship line is drawn to a "target"
entity because there isn't a single one. See [relationships.md](./relationships.md) for the full
explanation of every instance.

---

## 1. Auth & Organization (Phase 0)

`User`, `Session`, `Account`, `Verification`, `Organization`, `Membership`, `Workspace`. See
[schema.md#1-auth--organization-phase-0](./schema.md#1-auth--organization-phase-0).

```mermaid
erDiagram
  User {
    string id PK
    string name
    string email UK
    boolean emailVerified
    string image "avatar column"
    string firstName
    string lastName
    string title
    string department
    string phone
    string timezone
    UserStatus status
    datetime createdAt
    datetime updatedAt
  }
  Session {
    string id PK
    string userId FK
    string token UK
    datetime expiresAt
    string ipAddress
    string userAgent
    datetime createdAt
    datetime updatedAt
  }
  Account {
    string id PK
    string userId FK
    string accountId
    string providerId
    string accessToken
    string refreshToken
    datetime accessTokenExpiresAt
    datetime refreshTokenExpiresAt
    string scope
    string idToken
    string password
    datetime createdAt
    datetime updatedAt
  }
  Verification {
    string id PK
    string identifier
    string value
    datetime expiresAt
    datetime createdAt
    datetime updatedAt
  }
  Organization {
    string id PK
    string name
    string slug UK
    string logo
    string description
    string website
    string industry
    string size
    datetime createdAt
    datetime updatedAt
  }
  Membership {
    string id PK
    string userId FK
    string organizationId FK
    Role role
    datetime createdAt
    datetime updatedAt
  }
  Workspace {
    string id PK
    string organizationId FK, UK
    datetime createdAt
    datetime updatedAt
  }

  User ||--o{ Session : "sessions"
  User ||--o{ Account : "accounts"
  User ||--o{ Membership : "memberships"
  Organization ||--o{ Membership : "memberships"
  Organization ||--|| Workspace : "auto-provisioned 1:1"
```

`Verification` has no FK at all — it is looked up directly by `identifier`/`value` (email verification
and password-reset tokens), so it draws no relationship line.

---

## 2. Company Data (Phase 1)

`Project`, `ProjectMember`, `Task`, `TaskDocument`, `Document`, `Meeting`, `MeetingAttendee`, `Customer`,
`Email`. See [schema.md#2-company-data-phase-1](./schema.md#2-company-data-phase-1).

```mermaid
erDiagram
  Project {
    string id PK
    string organizationId FK
    string title
    string description
    ProjectStatus status
    Priority priority
    datetime startDate
    datetime dueDate
    string ownerId FK
    int version "optimistic lock, Phase 9"
    datetime createdAt
    datetime updatedAt
  }
  ProjectMember {
    string id PK
    string projectId FK
    string userId FK
    datetime createdAt
  }
  Task {
    string id PK
    string organizationId FK
    string projectId FK
    string title
    string description
    TaskStatus status
    Priority priority
    datetime dueDate
    datetime completedAt
    string assigneeId FK
    datetime createdAt
    datetime updatedAt
  }
  TaskDocument {
    string id PK
    string taskId FK
    string documentId FK
    datetime createdAt
  }
  Document {
    string id PK
    string organizationId FK
    string title
    string description
    DocumentType type
    string fileName
    string mimeType
    int size
    string storagePath
    string projectId FK
    string meetingId FK
    string uploadedById FK
    int version "optimistic lock, Phase 9"
    datetime createdAt
    datetime updatedAt
  }
  Meeting {
    string id PK
    string organizationId FK
    string projectId FK
    string title
    string agenda
    string notes
    string location
    datetime meetingDate
    int duration "minutes"
    int version "optimistic lock, Phase 9"
    datetime createdAt
    datetime updatedAt
  }
  MeetingAttendee {
    string id PK
    string meetingId FK
    string userId FK
    datetime createdAt
  }
  Customer {
    string id PK
    string organizationId FK
    string name
    string company "external company, not tenant Org"
    string email
    string phone
    string website
    CustomerStatus status
    string notes
    datetime createdAt
    datetime updatedAt
  }
  Email {
    string id PK
    string organizationId FK
    string customerId FK
    string projectId FK
    string subject
    string sender
    string recipient
    datetime sentAt
    EmailDirection direction
    datetime createdAt
  }

  Organization ||--o{ Project : "organizationId"
  Organization ||--o{ Task : "organizationId"
  Organization ||--o{ Document : "organizationId"
  Organization ||--o{ Meeting : "organizationId"
  Organization ||--o{ Customer : "organizationId"
  Organization ||--o{ Email : "organizationId"
  User |o--o{ Project : "owner (nullable, SetNull)"
  Project ||--o{ ProjectMember : "members"
  User ||--o{ ProjectMember : "user"
  Project ||--o{ Task : "tasks"
  User |o--o{ Task : "assignee (nullable, SetNull)"
  Task ||--o{ TaskDocument : "documents"
  Document ||--o{ TaskDocument : "tasks"
  Project |o--o{ Document : "project (nullable, Cascade)"
  Meeting |o--o{ Document : "meeting (nullable, Cascade)"
  User |o--o{ Document : "uploadedBy (nullable, SetNull)"
  Project ||--o{ Meeting : "meetings"
  Meeting ||--o{ MeetingAttendee : "attendees"
  User ||--o{ MeetingAttendee : "user"
  Customer ||--o{ Email : "emails"
  Project |o--o{ Email : "project (nullable, SetNull)"
  Customer }o--o{ Project : "_CustomerToProject (implicit m:n, no join model)"
```

`Customer.projects` / `Project.customers` is an **implicit** Prisma many-to-many (no `CustomerProject`
join model was declared) — Prisma auto-generates a hidden `_CustomerToProject` join table. See
[relationships.md](./relationships.md).

---

## 3. Data Layer / Ingestion (Phase 2)

`Entity`, `Folder`, `Source`, `KnowledgeDocument`, `Chunk`, `Attachment`, `Contact`, `Website`, `Tag`,
`EntityTag`, `EntityRelationship`, `Connector`, `SyncJob`. See
[schema.md#3-data-layer--ingestion-phase-2](./schema.md#3-data-layer--ingestion-phase-2) and
[../data-layer.md](../data-layer.md).

```mermaid
erDiagram
  Entity {
    string id PK
    string organizationId FK
    string creatorId FK
    EntityType entityType
    string title
    string description
    json metadata
    int version "optimistic lock, Phase 9"
    datetime createdAt
    datetime updatedAt
  }
  Folder {
    string id PK
    string organizationId FK
    string name
    string parentFolderId FK "self"
    string createdById FK
    datetime createdAt
    datetime updatedAt
  }
  Source {
    string id PK
    string organizationId FK
    string connectorId FK
    string name
    string externalId
    datetime createdAt
    datetime updatedAt
  }
  KnowledgeDocument {
    string id PK
    string entityId FK, UK
    string organizationId FK
    string folderId FK
    string sourceId FK
    string fileName
    string mimeType
    int size
    string storagePath
    string uploadedById FK
    ParseStatus parseStatus
    string parsedText
    json parsedPages
    json parsedMetadata
    datetime createdAt
    datetime updatedAt
  }
  Chunk {
    string id PK
    string knowledgeDocumentId FK
    ChunkType chunkType
    int position
    string content
    string contentHash
    int pageNumber
    datetime createdAt
  }
  Attachment {
    string id PK
    string entityId FK
    string organizationId FK
    string fileName
    string mimeType
    int size
    string storagePath
    datetime createdAt
  }
  Contact {
    string id PK
    string entityId FK, UK
    string organizationId FK
    string name
    string email
    string phone
    string company
    string jobTitle
    datetime createdAt
    datetime updatedAt
  }
  Website {
    string id PK
    string entityId FK, UK
    string organizationId FK
    string url
    string faviconUrl
    datetime lastCrawledAt
    datetime createdAt
    datetime updatedAt
  }
  Tag {
    string id PK
    string organizationId FK
    string name
    string color
    datetime createdAt
  }
  EntityTag {
    string id PK
    string entityId FK
    string tagId FK
    datetime createdAt
  }
  EntityRelationship {
    string id PK
    string organizationId FK
    string sourceEntityId FK
    string targetEntityId FK
    string relationType "free-form"
    datetime createdAt
  }
  Connector {
    string id PK
    string organizationId FK
    ConnectorProvider provider
    ConnectorStatus status
    json config
    string connectedById FK
    datetime lastSyncAt
    datetime createdAt
    datetime updatedAt
  }
  SyncJob {
    string id PK
    string organizationId FK
    string connectorId FK
    SyncJobStatus status
    SyncTrigger trigger
    datetime startedAt
    datetime completedAt
    int itemsProcessed
    int itemsFailed
    string errorMessage
    int retryCount
    datetime createdAt
  }

  Organization ||--o{ Entity : "organizationId"
  User |o--o{ Entity : "creator (nullable, SetNull)"
  Entity ||--o| KnowledgeDocument : "detail table (optional)"
  Entity ||--o| Contact : "detail table (optional)"
  Entity ||--o| Website : "detail table (optional)"
  Entity ||--o{ Attachment : "attachments"
  Entity ||--o{ EntityTag : "tags"
  Tag ||--o{ EntityTag : "entities"
  Entity ||--o{ EntityRelationship : "outgoing (sourceEntityId)"
  Entity ||--o{ EntityRelationship : "incoming (targetEntityId)"
  Organization ||--o{ Folder : "organizationId"
  Folder ||--o{ Folder : "parentFolder / childFolders (self)"
  User |o--o{ Folder : "createdBy (nullable, SetNull)"
  Folder |o--o{ KnowledgeDocument : "folder (nullable, SetNull)"
  Organization ||--o{ Source : "organizationId"
  Connector |o--o{ Source : "connector (nullable, SetNull)"
  Organization ||--o{ KnowledgeDocument : "organizationId"
  Source |o--o{ KnowledgeDocument : "source (nullable, SetNull)"
  User |o--o{ KnowledgeDocument : "uploadedBy (nullable, SetNull)"
  KnowledgeDocument ||--o{ Chunk : "chunks"
  Organization ||--o{ Attachment : "organizationId"
  Organization ||--o{ Contact : "organizationId"
  Organization ||--o{ Website : "organizationId"
  Organization ||--o{ Tag : "organizationId"
  Organization ||--o{ EntityRelationship : "organizationId"
  Organization ||--o{ Connector : "organizationId"
  User |o--o{ Connector : "connectedBy (nullable, SetNull)"
  Organization ||--o{ SyncJob : "organizationId"
  Connector ||--o{ SyncJob : "syncJobs"
```

---

## 4. Knowledge Graph (Phase 3)

`Relationship`, `TimelineEvent` — reusing `Entity` (domain 3) as the graph's node table. See
[schema.md#4-knowledge-graph-phase-3](./schema.md#4-knowledge-graph-phase-3),
[../knowledge-graph.md](../knowledge-graph.md), [../knowledge/graph.md](../knowledge/graph.md).

```mermaid
erDiagram
  Relationship {
    string id PK
    string organizationId FK
    string sourceEntityId FK
    string targetEntityId FK
    RelationshipType relationshipType
    float confidence "1.0 = deterministic; lower = heuristic"
    string createdById FK
    datetime createdAt
  }
  TimelineEvent {
    string id PK
    string organizationId FK
    string entityId FK
    TimelineEventType eventType
    string description
    json metadata
    datetime createdAt
  }

  Organization ||--o{ Relationship : "organizationId"
  Entity ||--o{ Relationship : "outgoing (sourceEntityId)"
  Entity ||--o{ Relationship : "incoming (targetEntityId)"
  User |o--o{ Relationship : "createdBy (nullable, SetNull)"
  Organization ||--o{ TimelineEvent : "organizationId"
  Entity ||--o{ TimelineEvent : "entityId, append-only"
```

`Relationship` (typed, confidence-scored graph edges) is deliberately a separate model from Phase 2's
`EntityRelationship` (domain 3) rather than a retrofit — see [relationships.md](./relationships.md).

---

## 5. AI Memory & Retrieval (Phase 4)

`Embedding`, `EmbeddingJob`, `AiAuditLog`. See
[schema.md#5-ai-memory--retrieval-phase-4](./schema.md#5-ai-memory--retrieval-phase-4),
[../embeddings.md](../embeddings.md), [../vector-search.md](../vector-search.md).

```mermaid
erDiagram
  Embedding {
    string id PK
    string organizationId FK
    EmbeddingSourceType sourceType "polymorphic, no FK"
    string sourceId "polymorphic, no FK"
    string content "exact embedded text"
    string embeddingModel
    string embeddingVersion
    int dimensions
    vector vector "Unsupported(vector(1536)), raw SQL only"
    datetime createdAt
  }
  EmbeddingJob {
    string id PK
    string organizationId FK
    EmbeddingJobType jobType
    EmbeddingSourceType sourceType "polymorphic, no FK"
    string sourceId "polymorphic, no FK"
    EmbeddingJobStatus status
    string provider
    string errorMessage
    int retryCount
    datetime startedAt
    datetime completedAt
    datetime createdAt
  }
  AiAuditLog {
    string id PK
    string organizationId FK
    string userId FK
    string action
    string provider
    json metadata
    datetime createdAt
  }

  Organization ||--o{ Embedding : "organizationId"
  Organization ||--o{ EmbeddingJob : "organizationId"
  Organization ||--o{ AiAuditLog : "organizationId"
  User |o--o{ AiAuditLog : "user (nullable, SetNull)"
```

`Embedding.sourceType`/`sourceId` and `EmbeddingJob.sourceType`/`sourceId` are the schema's canonical
polymorphic pattern — they span four unrelated tables (`Chunk`, `Entity`-as-NOTE, `Email`, `Meeting`) and
so draw **no** relationship line to any of them. See [relationships.md](./relationships.md).

---

## 6. Mr. Bond — Chat & RAG (Phase 5)

`Conversation`, `Message`, `OrganizationAiSettings`. See
[schema.md#6-mr-bond--chat--rag-phase-5](./schema.md#6-mr-bond--chat--rag-phase-5), [../mr-bond.md](../mr-bond.md),
[../rag.md](../rag.md).

```mermaid
erDiagram
  Conversation {
    string id PK
    string organizationId FK
    string createdById FK
    string title
    boolean pinned
    boolean archived
    datetime createdAt
    datetime updatedAt
  }
  Message {
    string id PK
    string conversationId FK
    string organizationId FK
    string userId FK
    MessageRole role
    string content
    json citations
    json metadata
    json tokenUsage
    string model
    datetime createdAt
  }
  OrganizationAiSettings {
    string id PK
    string organizationId FK, UK
    string provider
    string model
    float temperature
    float topP
    int maxTokens
    boolean streamingEnabled
    int contextWindow
    int retrievalDepth
    string updatedById FK
    datetime createdAt
    datetime updatedAt
  }

  Organization ||--o{ Conversation : "organizationId"
  User |o--o{ Conversation : "createdBy (nullable, SetNull — history survives the actor)"
  Conversation ||--o{ Message : "messages"
  Organization ||--o{ Message : "organizationId (denormalized)"
  User |o--o{ Message : "user (null for non-USER roles)"
  Organization ||--|| OrganizationAiSettings : "aiSettings, 1:1"
  User |o--o{ OrganizationAiSettings : "updatedBy (nullable, SetNull)"
```

---

## 7. Execution & Approvals — Tool Execution Framework (Phase 6)

`Tool`, `ExecutionPlan`, `ApprovalRequest`, `ToolExecution`, `ExecutionStep`, `RollbackRecord`, `AuditEvent`.
See [schema.md#7-execution--approvals--tool-execution-framework-phase-6](./schema.md#7-execution--approvals--tool-execution-framework-phase-6),
[../approvals.md](../approvals.md), [../tool-execution.md](../tool-execution.md), [../rollback.md](../rollback.md).

```mermaid
erDiagram
  Tool {
    string id PK
    string toolKey "not org-scoped"
    string version
    string name
    string displayName
    string description
    ToolCategory category
    string icon
    Role minimumRole
    json parametersSchema
    json outputSchema
    boolean supportsRollback
    RollbackSupport rollbackSupport
    boolean supportsPreview
    boolean supportsDryRun
    boolean supportsTransactions
    boolean requiresApproval
    int estimatedExecutionMs
    datetime createdAt
    datetime updatedAt
  }
  ExecutionPlan {
    string id PK
    string organizationId FK
    string conversationId FK
    string createdById FK
    string summary
    json steps
    json graph
    string planHash "sha256, re-verified at execution time"
    int estimatedTimeMs
    RollbackSupport rollbackStrategy
    datetime createdAt
  }
  ApprovalRequest {
    string id PK
    string planId FK, UK
    string organizationId FK
    Role requiredRole
    ApprovalStatus status
    string approvedById FK
    datetime approvedAt
    datetime expiresAt
    datetime createdAt
  }
  ToolExecution {
    string id PK
    string planId FK, UK
    string toolId FK
    string organizationId FK
    string conversationId FK
    ExecutionStatus status
    datetime startedAt
    datetime completedAt
    int duration
    string createdById FK
    RollbackRecordStatus rollbackStatus
    string error
    string workflowRunStepId FK, UK "Phase 8, nullable"
    datetime createdAt
  }
  ExecutionStep {
    string id PK
    string executionId FK
    int order
    string tool "toolKey, NOT an FK to Tool"
    StepStatus status
    int duration
    json result
    json rollback
    datetime createdAt
  }
  RollbackRecord {
    string id PK
    string executionId FK, UK
    RollbackRecordStatus status
    datetime completedAt
    json details
    datetime createdAt
  }
  AuditEvent {
    string id PK
    string organizationId FK
    string executionId FK
    string userId FK
    string action "free-form lifecycle string"
    json metadata
    datetime createdAt
  }

  Tool ||--o{ ToolExecution : "tool (nullable, SetNull)"
  Organization ||--o{ ExecutionPlan : "organizationId"
  Conversation |o--o{ ExecutionPlan : "conversation (nullable, SetNull)"
  User |o--o{ ExecutionPlan : "createdBy (nullable, SetNull)"
  ExecutionPlan ||--o| ApprovalRequest : "approval, 1:1"
  Organization ||--o{ ApprovalRequest : "organizationId"
  User |o--o{ ApprovalRequest : "approvedBy (nullable, SetNull)"
  ExecutionPlan ||--o| ToolExecution : "execution, 1:1"
  Organization ||--o{ ToolExecution : "organizationId"
  Conversation |o--o{ ToolExecution : "conversation (nullable, SetNull)"
  User |o--o{ ToolExecution : "createdBy (nullable, SetNull)"
  WorkflowRunStep |o--o| ToolExecution : "workflowRunStep (nullable, SetNull; Phase 8 bridge)"
  ToolExecution ||--o{ ExecutionStep : "steps"
  ToolExecution ||--o| RollbackRecord : "rollback, 1:1"
  ToolExecution |o--o{ AuditEvent : "execution (nullable, SetNull)"
  Organization ||--o{ AuditEvent : "organizationId"
  User |o--o{ AuditEvent : "user (nullable, SetNull)"
```

`ExecutionStep.tool` stores the `toolKey` string, not an FK to `Tool` — resolved at plan-build time and
re-validated against the live `ToolRegistry` before running. `AuditEvent` has a real, nullable hard FK to
`ToolExecution` (not a polymorphic entityType/entityId pair) — see [relationships.md](./relationships.md).

---

## 8. Agent Framework — AI Workforce (Phase 7)

`Agent`, `AgentGoal`, `GoalStep`, `Insight`, `AgentTimelineEvent`. See
[schema.md#8-agent-framework--ai-workforce-phase-7](./schema.md#8-agent-framework--ai-workforce-phase-7),
[../agents.md](../agents.md), [../multi-agent.md](../multi-agent.md), [../goals.md](../goals.md),
[../insights.md](../insights.md).

```mermaid
erDiagram
  Agent {
    string id PK
    string agentKey "not org-scoped"
    string version
    string name
    string displayName
    string description
    string avatar
    AgentCategory category
    json capabilities
    json supportedTools
    json supportedKnowledge
    int priority
    string model
    float temperature
    int maxContext
    AgentRegistryStatus status
    Role minimumRole
    datetime createdAt
    datetime updatedAt
  }
  AgentGoal {
    string id PK
    string organizationId FK
    string agentId FK
    string conversationId FK
    string createdById FK
    string title
    json originalPlan
    GoalStatus status
    datetime lastActivityAt "advances only on explicit user action"
    datetime createdAt
    datetime updatedAt
  }
  GoalStep {
    string id PK
    string goalId FK
    int order
    GoalStepPhase phase
    json output "structured only, never raw prompt/completion"
    TriggeredBy triggeredBy
    datetime createdAt
  }
  Insight {
    string id PK
    string organizationId FK
    string agentId FK
    string goalId FK
    InsightType type
    string title
    string description
    json relatedEntityIds
    InsightStatus status
    datetime createdAt
    datetime updatedAt
  }
  AgentTimelineEvent {
    string id PK
    string organizationId FK
    string agentId FK
    string conversationId FK
    string goalId "plain column, NO relation/FK"
    AgentEventType eventType
    json metadata "allowlisted structured DTO, never chain-of-thought"
    datetime createdAt
  }

  Organization ||--o{ AgentGoal : "organizationId"
  Agent ||--o{ AgentGoal : "agent (Restrict — cannot delete an Agent with goals)"
  Conversation |o--o{ AgentGoal : "conversation (nullable, SetNull)"
  User |o--o{ AgentGoal : "createdBy (nullable, SetNull)"
  AgentGoal ||--o{ GoalStep : "steps"
  Organization ||--o{ Insight : "organizationId"
  Agent ||--o{ Insight : "agent (Restrict)"
  AgentGoal |o--o{ Insight : "goal (nullable, SetNull)"
  Organization ||--o{ AgentTimelineEvent : "organizationId"
  Agent ||--o{ AgentTimelineEvent : "agent (Restrict)"
  Conversation |o--o{ AgentTimelineEvent : "conversation (nullable, SetNull)"
```

`AgentTimelineEvent.goalId` is deliberately **not** wired as a Prisma relation (no `@relation`, no FK) —
it is a plain optional string column, so no relationship line is drawn to `AgentGoal` for it. All three
`agent` relations here use `onDelete: Restrict` (the schema's only three `Restrict` FKs besides
`WorkflowRun.workflowDefinition` and `Comment.author`) — see [relationships.md](./relationships.md).

---

## 9. Workflow Automation Platform (Phase 8)

`WorkflowDefinition`, `WorkflowRun`, `WorkflowRunStep`, `Event`, `WorkflowSchedule`,
`WorkflowWebhookDelivery`. See
[schema.md#9-workflow-automation-platform-phase-8](./schema.md#9-workflow-automation-platform-phase-8),
[../workflows.md](../workflows.md), [../event-bus.md](../event-bus.md), [../scheduling.md](../scheduling.md).

```mermaid
erDiagram
  WorkflowDefinition {
    string id PK
    string organizationId FK
    string workflowKey
    string version
    string name
    string description
    WorkflowDefinitionStatus status
    string ownerId FK
    TriggerType triggerType
    json trigger
    json conditions
    json graph "flat DAG via dependsOn"
    json retryPolicy
    int timeoutMs
    json rollbackPolicy
    string webhookSecret "plaintext, WEBHOOK trigger only"
    datetime createdAt
    datetime updatedAt
  }
  WorkflowRun {
    string id PK
    string organizationId FK
    string workflowDefinitionId FK
    string triggerEventId FK
    WorkflowRunStatus status
    string correlationId "tracing id for this trigger's chain"
    string causationId
    string error
    datetime startedAt
    datetime completedAt
    datetime createdAt
    datetime updatedAt
  }
  WorkflowRunStep {
    string id PK
    string runId FK
    string key
    WorkflowStepType stepType
    WorkflowStepRunStatus status
    json input
    json output
    string error
    int attempt
    int loopIndex
    datetime waitUntil
    string planId "soft ref to ExecutionPlan.id, NO FK"
    datetime startedAt
    datetime completedAt
    datetime createdAt
  }
  Event {
    string id PK
    string organizationId FK
    string eventType "free-form dotted string"
    EventSource source
    json payload
    string correlationId
    string causationId
    json metadata
    string entityType "polymorphic, no FK"
    string entityId "polymorphic, no FK"
    datetime createdAt
  }
  WorkflowSchedule {
    string id PK
    string organizationId FK
    string workflowDefinitionId FK, UK
    string cronExpression
    string timezone
    datetime nextRunAt
    datetime lastRunAt
    WorkflowScheduleStatus status
    datetime createdAt
    datetime updatedAt
  }
  WorkflowWebhookDelivery {
    string id PK
    string workflowDefinitionId FK
    string idempotencyKey
    datetime receivedAt
  }

  Organization ||--o{ WorkflowDefinition : "organizationId"
  User |o--o{ WorkflowDefinition : "owner (nullable, SetNull)"
  WorkflowDefinition ||--o{ WorkflowRun : "runs (Restrict — cannot delete a def with runs)"
  Organization ||--o{ WorkflowRun : "organizationId"
  Event |o--o{ WorkflowRun : "triggerEvent (nullable, SetNull)"
  WorkflowRun ||--o{ WorkflowRunStep : "steps"
  Organization ||--o{ Event : "organizationId"
  WorkflowDefinition ||--o| WorkflowSchedule : "schedule, 1:1"
  Organization ||--o{ WorkflowSchedule : "organizationId"
  WorkflowDefinition ||--o{ WorkflowWebhookDelivery : "webhookDeliveries"
```

`WorkflowRunStep.planId` is a soft reference to `ExecutionPlan.id` (domain 7) with no FK — resolved at
runtime, matching `ExecutionStep.tool`'s precedent. `ToolExecution.workflowRunStepId` (domain 7) is the
actual hard FK bridging Phase 8 back into Phase 6; see that diagram (§7) for the line.

---

## 10. Enterprise Collaboration (Phase 9)

`Comment`, `CommentAttachment`, `Mention`, `Notification`, `Space`, `SpaceMember`, `SpaceProject`,
`SpaceKnowledgeDocument`, `SpaceWorkflow`, `SpaceAgent`, `ConversationShare`, `EntityVersionSnapshot`.
See [schema.md#10-enterprise-collaboration-phase-9](./schema.md#10-enterprise-collaboration-phase-9),
[../collaboration.md](../collaboration.md), [../comments.md](../comments.md),
[../notifications.md](../notifications.md), [../spaces.md](../spaces.md).

```mermaid
erDiagram
  Comment {
    string id PK
    string organizationId FK
    CommentableEntityType entityType "polymorphic, no FK"
    string entityId "polymorphic, no FK"
    string authorId FK
    string parentCommentId FK "self"
    string content
    boolean resolved
    string resolvedById FK
    datetime resolvedAt
    datetime createdAt
    datetime updatedAt
  }
  CommentAttachment {
    string id PK
    string commentId FK
    string fileName
    string mimeType
    int size
    string storagePath
    datetime createdAt
  }
  Mention {
    string id PK
    string organizationId FK
    string commentId FK
    MentionType mentionedType "discriminator: USER/SPACE/AGENT"
    string mentionedUserId FK "used if USER"
    string mentionedSpaceId FK "used if SPACE"
    string mentionedAgentKey "soft ref to Agent.agentKey, NO FK; used if AGENT"
    datetime createdAt
  }
  Notification {
    string id PK
    string organizationId FK
    string userId FK
    NotificationType type
    string title
    string body
    string entityType "polymorphic, no FK"
    string entityId "polymorphic, no FK"
    string sourceEventId "soft ref to Event.id, NO FK"
    boolean read
    datetime readAt
    boolean archived
    datetime snoozedUntil
    datetime createdAt
  }
  Space {
    string id PK
    string organizationId FK
    string name
    string description
    string createdById FK
    datetime createdAt
    datetime updatedAt
  }
  SpaceMember {
    string id PK
    string spaceId FK
    string userId FK
    datetime joinedAt
  }
  SpaceProject {
    string id PK
    string spaceId FK
    string projectId "soft ref to Project.id, NO FK"
    datetime createdAt
  }
  SpaceKnowledgeDocument {
    string id PK
    string spaceId FK
    string knowledgeDocumentId "soft ref, NO FK"
    datetime createdAt
  }
  SpaceWorkflow {
    string id PK
    string spaceId FK
    string workflowDefinitionId "soft ref, NO FK"
    datetime createdAt
  }
  SpaceAgent {
    string id PK
    string spaceId FK
    string agentKey "soft ref to Agent.agentKey, NO FK"
    datetime createdAt
  }
  ConversationShare {
    string id PK
    string organizationId FK
    string conversationId FK
    string sharedWithUserId FK
    SharePermission permission
    string sharedById FK
    datetime createdAt
  }
  EntityVersionSnapshot {
    string id PK
    string organizationId FK
    string entityType "polymorphic, no FK, plain String not enum"
    string entityId "polymorphic, no FK"
    int version
    json snapshot "full prior row state"
    string editedById FK
    datetime createdAt
  }

  Organization ||--o{ Comment : "organizationId"
  User ||--o{ Comment : "author (Restrict — cannot delete a user with comments)"
  User |o--o{ Comment : "resolvedBy (nullable, SetNull)"
  Comment ||--o{ Comment : "parentComment / replies (self)"
  Comment ||--o{ CommentAttachment : "attachments"
  Comment ||--o{ Mention : "mentions"
  Organization ||--o{ Mention : "organizationId"
  User |o--o{ Mention : "mentionedUser (nullable, Cascade)"
  Space |o--o{ Mention : "mentionedSpace (nullable, Cascade)"
  Organization ||--o{ Notification : "organizationId"
  User ||--o{ Notification : "user"
  Organization ||--o{ Space : "organizationId"
  User |o--o{ Space : "createdBy (nullable, SetNull)"
  Space ||--o{ SpaceMember : "members"
  User ||--o{ SpaceMember : "user"
  Space ||--o{ SpaceProject : "projects"
  Space ||--o{ SpaceKnowledgeDocument : "documents"
  Space ||--o{ SpaceWorkflow : "workflows"
  Space ||--o{ SpaceAgent : "agents"
  Organization ||--o{ ConversationShare : "organizationId"
  Conversation ||--o{ ConversationShare : "shares"
  User ||--o{ ConversationShare : "sharedWith (Cascade)"
  User |o--o{ ConversationShare : "sharedBy (nullable, SetNull)"
  Organization ||--o{ EntityVersionSnapshot : "organizationId"
  User |o--o{ EntityVersionSnapshot : "editedBy (nullable, SetNull)"
```

The four `Space*` link models (`SpaceProject`, `SpaceKnowledgeDocument`, `SpaceWorkflow`, `SpaceAgent`)
each carry only `spaceId` as a real FK — their other id column (`projectId`, `knowledgeDocumentId`,
`workflowDefinitionId`, `agentKey`) is a plain, unconstrained string, so no relationship line is drawn
from them to `Project`/`KnowledgeDocument`/`WorkflowDefinition`/`Agent`. See
[relationships.md](./relationships.md).

---

## Full model coverage checklist

All 67 models, cross-referenced against `schema.prisma`:

**Domain 1 (7):** User, Session, Account, Verification, Organization, Membership, Workspace
**Domain 2 (9):** Project, ProjectMember, Task, TaskDocument, Document, Meeting, MeetingAttendee, Customer, Email
**Domain 3 (13):** Entity, Folder, Source, KnowledgeDocument, Chunk, Attachment, Contact, Website, Tag, EntityTag, EntityRelationship, Connector, SyncJob
**Domain 4 (2):** Relationship, TimelineEvent
**Domain 5 (3):** Embedding, EmbeddingJob, AiAuditLog
**Domain 6 (3):** Conversation, Message, OrganizationAiSettings
**Domain 7 (7):** Tool, ExecutionPlan, ApprovalRequest, ToolExecution, ExecutionStep, RollbackRecord, AuditEvent
**Domain 8 (5):** Agent, AgentGoal, GoalStep, Insight, AgentTimelineEvent
**Domain 9 (6):** WorkflowDefinition, WorkflowRun, WorkflowRunStep, Event, WorkflowSchedule, WorkflowWebhookDelivery
**Domain 10 (12):** Comment, CommentAttachment, Mention, Notification, Space, SpaceMember, SpaceProject, SpaceKnowledgeDocument, SpaceWorkflow, SpaceAgent, ConversationShare, EntityVersionSnapshot

7 + 9 + 13 + 2 + 3 + 3 + 7 + 5 + 6 + 12 = **67**.
