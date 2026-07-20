# Approval Gate (Phase 6)

## Scope

`apps/web/features/approvals/services/approval.service.ts` — the single choke point between a
Planner-built `ExecutionPlan` and the `ExecutionService` that actually runs it. Its own doc comment
states the design in full:

```ts
/**
 * The approval gate (Phase 6). Single-use/replay protection is an atomic,
 * org-scoped conditional `updateMany` (`transitionApprovalRequest`), not a
 * signed token — see docs/approvals.md for why a signature was considered
 * and dropped.
 */
export class ApprovalService {
```

That comment is repeated, near-verbatim, on the `ApprovalRequest` Prisma model and on the
`transitionApprovalRequest` repository function — three independent places in the codebase all point
at this document for the same "why not a signature" question. This doc answers it, then walks the
three mechanisms that replaced the idea: the atomic `updateMany` (single-use/replay), the plain
`planHash` (plan integrity), and server-computed `requiredRole` (authorization). It closes with the
approve/reject HTTP routes and how `/approve` reuses Mr. Bond's own SSE transport unmodified.

`ExecutionService.executeApprovedPlan`'s opening line is `await
this.approvalService.approve(...)` — nothing else in the Tool Execution Framework runs before that
call succeeds (see docs/tool-execution.md). This gate is not one safeguard among several; it is the
one and only door into every write the framework can perform.

## The schema: `ApprovalRequest`

```prisma
/// The approval gate itself. Single-use/replay protection is an atomic,
/// org-scoped conditional `updateMany` (status = PENDING AND not expired ->
/// APPROVED), not a signature — see docs/approvals.md for why a signed token
/// was considered and dropped. `requiredRole` is computed as the max
/// ROLE_HIERARCHY severity across every step's tool in the plan, never
/// client-supplied.
model ApprovalRequest {
  id             String         @id @default(cuid())
  planId         String         @unique
  organizationId String
  requiredRole   Role
  status         ApprovalStatus @default(PENDING)
  approvedById   String?
  approvedAt     DateTime?
  expiresAt      DateTime
  createdAt      DateTime       @default(now())

  plan         ExecutionPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  organization Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  approvedBy   User?         @relation("ApprovalRequestApprovedBy", fields: [approvedById], references: [id], onDelete: SetNull)

  @@index([organizationId])
  @@index([status])
  @@map("approval_requests")
}

enum ApprovalStatus {
  PENDING
  APPROVED
  REJECTED
  EXPIRED
  CANCELLED
}
```

`planId` is `@unique` — one `ApprovalRequest` per `ExecutionPlan`, a true 1:1, enforced at the schema
level rather than by convention. There is no token, secret, or signature column anywhere on this
model: the row's own primary key plus its `organizationId`/`status`/`expiresAt` columns are the
entirety of what authorizes a transition. `requiredRole` is a plain `Role` enum column, computed once
at plan-build time and never recomputed or re-derived from client input afterward (see below).

## `ApprovalService`

```ts
export class ApprovalService {
  async requestApproval(organizationId: string, planId: string, requiredRole: Role): Promise<ApprovalRequestData> {
    const expiresAt = new Date(Date.now() + getEnv().APPROVAL_EXPIRY_MINUTES * 60 * 1000);
    return createApprovalRequest({ planId, organizationId, requiredRole, expiresAt });
  }

  async getForPlan(organizationId: string, planId: string): Promise<ApprovalRequestData> {
    await expireStaleApprovalRequests(organizationId);
    const approval = await getApprovalRequestByPlanId(planId, organizationId);
    if (!approval) throw new NotFoundError('Approval request not found.');
    return approval;
  }

  /**
   * Atomically transitions `PENDING` -> `APPROVED`. Throws `ForbiddenError`
   * if the caller's role doesn't meet the plan's own computed
   * `requiredRole` (never a generic MEMBER-only check), and `ConflictError`
   * if the race was already lost (double-click, replay, or genuinely
   * expired) — the DB's conditional `updateMany` is the actual single-use
   * enforcement, this method just surfaces its result as the right error.
   */
  async approve(organizationId: string, userId: string, planId: string, callerRole: Role): Promise<ApprovalRequestData> {
    await expireStaleApprovalRequests(organizationId);
    const approval = await getApprovalRequestByPlanId(planId, organizationId);
    if (!approval) throw new NotFoundError('Approval request not found.');

    if (!roleSatisfies(callerRole, approval.requiredRole)) {
      throw new ForbiddenError(`Approving this plan requires the ${approval.requiredRole} role.`);
    }

    const won = await transitionApprovalRequest(approval.id, organizationId, 'APPROVED', userId);
    if (!won) {
      throw new ConflictError('This approval request is no longer pending (already approved, rejected, or expired).');
    }

    return { ...approval, status: 'APPROVED', approvedById: userId, approvedAt: new Date() };
  }

  async reject(organizationId: string, planId: string): Promise<void> {
    const approval = await this.getForPlan(organizationId, planId);
    const won = await transitionApprovalRequest(approval.id, organizationId, 'REJECTED');
    if (!won) {
      throw new ConflictError('This approval request is no longer pending (already approved, rejected, or expired).');
    }
  }
}
```

Four methods, no more: `requestApproval` (called by the Planner once a plan is built — see
docs/planner.md), `getForPlan` (read, opportunistically sweeping stale rows first), `approve`, and
`reject`. Both mutating methods share the same shape: look the row up, check what needs checking
*in application code* (role sufficiency for `approve`; nothing extra for `reject`), then hand off to
`transitionApprovalRequest` and translate a lost race into `ConflictError`. Neither method ever writes
`status` itself — the actual write, and the actual enforcement of "only once," happens one layer down.

## Why not an HMAC-signed token

A natural first design for "prove this approval is genuine and hasn't been used before" is a signed,
bearer-style token: sign `{ planId, organizationId, requiredRole, expiresAt }` with a server secret,
hand the signature to the approver, and verify it on `/approve` instead of (or alongside) a database
lookup. That shape is common where the approver is off-system — a magic link mailed to someone, a
webhook callback from another service — because it lets verification happen without a trusted, stateful
lookup on the verifying side.

It was considered here and dropped, for three concrete reasons that map onto the three mechanisms this
doc documents below:

1. **A signature cannot provide single-use/replay protection by itself, and once you add the state
   that actually provides it, the signature stops earning its keep.** HMAC verification proves a
   token's *claims* weren't altered; it says nothing about whether that exact, still-valid token has
   already been redeemed. Two concurrent requests presenting the identical signed token both pass
   verification — nothing about the cryptography changes between the first and second check. Solving
   that requires a server-side "already consumed" flag checked and set atomically, which is precisely
   what `transitionApprovalRequest`'s conditional `updateMany` already is. Once that DB-backed,
   atomic state transition exists — and it has to exist regardless, because it's the only thing that
   can make "only once" true under concurrency — a signature adds a second, independent mechanism for
   a property the first mechanism already fully owns.
2. **There is no off-system channel in this flow for a signature to authenticate across.** The
   `/approve` and `/reject` routes run inside an authenticated, same-origin session
   (`requireAuth()`/`requireRole()`, `assertSameOrigin` — see the routes below); there is no emailed
   link, no cross-service webhook, no detached bearer credential that needs to prove its own provenance
   the way a JWT would for, say, a password-reset email. The caller is already a known, authenticated
   member of the organization by the time `approve()` runs; what remains to check is whether *that*
   caller's role is high enough, which `roleSatisfies(callerRole, approval.requiredRole)` answers
   directly against the row — a signature would only be re-proving something the session already
   proved.
3. **The values a token would need to protect from tampering are never client-supplied in the first
   place.** A signed token's real job is stopping a client from handing back a claim the server didn't
   originally issue — e.g. a forged `requiredRole: MEMBER` on a plan that actually needs `ADMIN`. Here,
   `requiredRole` is computed server-side by `PermissionService` at plan-build time and stored on the
   row (see below); `approve()` never reads a role, plan hash, or expiry from the request body or the
   URL — the URL supplies only `planId`, used purely to look the authoritative row up. There is no
   claim in this flow that travels through the client and back that a signature would need to protect.

Put together: single-use/replay is a concurrency problem, solved by an atomic DB transition, not a
cryptography problem; and the "was this tampered with" question a signature answers is moot when
nothing security-relevant ever leaves the server and comes back. What a signed token would have added
— key management, a signing/verification code path, and a new class of bug (constant-time comparison,
algorithm confusion, a duplicate expiry claim independently driftable from the row's own `expiresAt`)
— bought no property this design didn't already have. The three subsections below are what actually
replaced the idea.

### 1. The atomic org-scoped conditional `updateMany` — the real single-use guard

```ts
/**
 * The single-use enforcement mechanism: `status` only transitions from
 * `PENDING` to `APPROVED`/`REJECTED` if it's still `PENDING` and not
 * expired, atomically, in the same query as the tenant filter. Returns
 * `true` only if this call was the one that won the race — a second
 * concurrent call (double-click, replay) sees `count === 0` and returns
 * `false`.
 */
export async function transitionApprovalRequest(
  id: string,
  organizationId: string,
  toStatus: Extract<ApprovalStatus, 'APPROVED' | 'REJECTED' | 'CANCELLED'>,
  approvedById?: string,
): Promise<boolean> {
  const result = await prisma.approvalRequest.updateMany({
    where: { id, organizationId, status: 'PENDING', expiresAt: { gt: new Date() } },
    data: {
      status: toStatus,
      approvedById: toStatus === 'APPROVED' ? approvedById : undefined,
      approvedAt: toStatus === 'APPROVED' ? new Date() : undefined,
    },
  });
  return result.count === 1;
}
```

The whole guard is the shape of this one query: `id` + `organizationId` + `status: 'PENDING'` +
`expiresAt: { gt: new Date() }` all sit in the same `where`, and the write only happens if that
`where` still matches at the moment Postgres evaluates it. Two simultaneous callers racing to approve
the same plan both issue this exact `updateMany`; the database, not application code, decides which
one's write lands first, and the loser's `where` no longer matches (`status` is already `APPROVED`) so
its `count` comes back `0`. `ApprovalService.approve`/`.reject` read that boolean back as `won` and
turn a loss into `ConflictError` — never a silent no-op, never a second write. This is why the
repository file's own comment calls out the alternative it replaces explicitly: "never a plain
`findFirst` + `update` pair, which would race" — a separate read-then-write is exactly the shape that
lets two concurrent requests both observe `PENDING` before either one writes.

`expireStaleApprovalRequests` is the same pattern applied opportunistically rather than on a timer:

```ts
/** Flags any PENDING-but-past-`expiresAt` rows for an organization as EXPIRED — called opportunistically when an approval is looked up, mirroring the "no real worker loop, checked on access" honesty already established for jobs/sync. */
export async function expireStaleApprovalRequests(organizationId: string): Promise<number> {
  const result = await prisma.approvalRequest.updateMany({
    where: { organizationId, status: 'PENDING', expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}
```

`ApprovalService.getForPlan` and `.approve` both call this before doing anything else, so a
request against a row that's technically still `PENDING` in the database but past its `expiresAt` gets
flagged `EXPIRED` first — `approve()` on such a row then fails the same way any other lost race does,
via `transitionApprovalRequest`'s own `expiresAt: { gt: new Date() }` guard (belt and suspenders: even
if the opportunistic sweep hadn't run, the conditional `updateMany` would still refuse the stale row).

### 2. `planHash` — the real plan-integrity guard

The property a signature's tamper-evidence would have covered for plan *content* — "has this changed
since it was approved" — is handled by a plain, unsigned SHA-256 digest instead, recomputed and
compared at execution time. `hashContent` is `@bond-os/parsers`' existing content-hash primitive
(already used by `Chunk.contentHash` for re-sync change detection):

```ts
import { createHash } from 'node:crypto';

/** Content-addressable hash used by Chunk.contentHash for future change detection on re-sync. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
```

`PlannerService` canonicalizes each step's identity fields (sorting `dependsOn` so key order can't
change the hash) and feeds the JSON string through it, once at plan-build time:

```ts
private computeHash(steps: ExecutionStepDefinition[]): string {
  const canonical = steps.map((step) => ({
    key: step.key,
    toolKey: step.toolKey,
    version: step.version,
    params: step.params,
    dependsOn: [...step.dependsOn].sort(),
    condition: step.condition ?? null,
    retry: step.retry ?? null,
  }));
  return hashContent(JSON.stringify(canonical));
}

/** Recomputes the hash of `steps` the same way `buildPlan` did — `ExecutionService` compares this against the stored `planHash` right before executing, and hard-fails on a mismatch rather than running a possibly-tampered plan. */
hashSteps(steps: ExecutionStepDefinition[]): string {
  return this.computeHash(steps);
}
```

`ExecutionPlan.planHash` is written once, by `buildPlan`, and never updated again. `ExecutionService`
recomputes it with the identical function immediately after `approve()` succeeds and before a single
step runs:

```ts
const stepDefs = plan.steps as unknown as ExecutionStepDefinition[];
const graph = plan.graph as unknown as PlanGraph;

if (this.plannerService.hashSteps(stepDefs) !== plan.planHash) {
  throw new ConflictError('This plan changed since it was approved. Please build and approve a new plan.');
}
```

No secret is involved anywhere in this check — `hashSteps` is a pure, public function; anyone with the
same `steps` array gets the same digest. That's fine, because the property being verified isn't
"prove you're allowed to produce this hash" (that's the approval gate's job), it's "prove `steps` is
byte-for-byte what it was when the plan was hashed" — and a plain digest compared server-side, against
a value only the server itself ever wrote, already delivers that. `steps` is never re-supplied by the
client at execution time either; it's read straight back off the `ExecutionPlan` row by `planId`, so
the only way this check can fail is if the stored row itself changed between build and execution — a
possibly-tampered or since-mutated plan, exactly the case a signature over the same content would
otherwise have been guarding against.

### 3. `requiredRole` — computed server-side, never client-supplied

The third piece of what a signed token's tamper-evidence would otherwise protect — "prove the
authorization level attached to this approval wasn't lowered by the client" — is handled by never
letting `requiredRole` be a client-supplied value at all. `PermissionService` computes it once, from
the plan's own resolved tools, at build time:

```ts
/**
 * Computes the role required to approve a plan (Phase 6, §1 of the plan:
 * "requiredRole = max severity across all steps," never client-supplied).
 * A plan mixing a MEMBER-tier step and an ADMIN-tier step requires ADMIN to
 * approve. See docs/approvals.md.
 */
export class PermissionService {
  requiredRoleForTools(tools: AnyToolDefinition[]): Role {
    let required: Role = ROLES.MEMBER;
    for (const tool of tools) {
      const role = tool.permissions();
      if (ROLE_HIERARCHY[role] > ROLE_HIERARCHY[required]) required = role;
    }
    return required;
  }
}
```

Each tool declares its own fixed minimum via `permissions()` — `create_project`/`update_project`/
`create_task`/`create_meeting` all return `ROLES.MEMBER`, `archive_project` returns `ROLES.ADMIN` (see
`apps/web/features/tools/definitions/*.tool.ts`). `requiredRoleForTools` walks every tool in the plan
and keeps the highest severity seen, using the shared `ROLE_HIERARCHY` (`OWNER: 3, ADMIN: 2, MEMBER:
1`) — a plan mixing a `create_project` step with an `archive_project` step ends up `ADMIN`, not
`MEMBER`, because one under-privileged step is enough to raise the whole plan's bar. `PlannerService`
calls this once (`this.permission.requiredRoleForTools(tools)`) and writes the result onto
`ApprovalRequest.requiredRole` via `requestApproval` — nothing downstream ever recomputes or accepts
an override for it.

`approve()`'s own role check reads that stored value back and compares it against the *caller's live,
freshly-looked-up* membership role — never anything carried by the client:

```ts
if (!roleSatisfies(callerRole, approval.requiredRole)) {
  throw new ForbiddenError(`Approving this plan requires the ${approval.requiredRole} role.`);
}
```

`callerRole` itself comes from the `/approve` route's own `requireRole(organizationId, ROLES.MEMBER)`
call against the caller's session — see below. So the full chain from tool declaration to enforcement
never once passes through a value the client could have supplied or altered: tool `permissions()` ->
`PermissionService` -> `ApprovalRequest.requiredRole` (write, once) -> `approve()`'s comparison against
a session-derived `callerRole` (read, every attempt).

## `APPROVAL_EXPIRY_MINUTES`

```ts
// Phase 6 — Tool Execution Framework. How long an ApprovalRequest stays
// PENDING before `expireStaleApprovalRequests` flags it EXPIRED.
APPROVAL_EXPIRY_MINUTES: z.coerce.number().int().positive().default(15),
```

One env var, `packages/shared/src/env.ts`, validated fail-fast alongside every other server-only
setting. Default `15` minutes, any positive integer accepted. `requestApproval` is its only reader:

```ts
async requestApproval(organizationId: string, planId: string, requiredRole: Role): Promise<ApprovalRequestData> {
  const expiresAt = new Date(Date.now() + getEnv().APPROVAL_EXPIRY_MINUTES * 60 * 1000);
  return createApprovalRequest({ planId, organizationId, requiredRole, expiresAt });
}
```

`expiresAt` is computed once, at request-creation time, and stored as a plain `DateTime` column — it
is never recomputed, extended, or reset by any later call. There is one global value for every
organization and every plan; nothing in this phase makes expiry configurable per-plan, per-tool, or
per-org (see "What's deliberately not built" below).

## The approve/reject routes

### `POST /api/execution/[id]/approve`

```ts
/**
 * THE gate's HTTP entry point (Phase 6) — an SSE stream, structurally
 * identical to `/api/bond/chat`. `ExecutionService.executeApprovedPlan`'s
 * very first line is `approvalService.approve(...)`; nothing past that runs
 * until the atomic PENDING -> APPROVED transition succeeds, so this route
 * does no approval logic of its own — it only resolves the caller's role
 * and hands off. Rate-limited the same as Mr. Bond's own chat endpoint,
 * since a successful call here triggers real writes.
 */
export const POST = apiHandler<Context>(
  withRateLimit(
    async (request, { params }: Context) => {
      assertSameOrigin(request);
      const { user } = await requireAuth();
      const organizationId = await requireActiveOrganizationId();
      const { id: planId } = await params;

      // MEMBER is just the floor needed to attempt approval at all —
      // ApprovalService.approve() checks the caller's role against the
      // specific plan's own computed requiredRole and throws ForbiddenError
      // itself; that real check is never duplicated or second-guessed here.
      const { membership } = await requireRole(organizationId, ROLES.MEMBER);

      // Carry the plan's own conversationId through (if it was proposed
      // from a Mr. Bond chat turn) so the outcome message lands back in
      // that conversation instead of being silently dropped.
      const plan = await getExecutionPlanById(planId, organizationId);

      const generator = getExecutionService().executeApprovedPlan(
        { organizationId, userId: user.id, conversationId: plan?.conversationId ?? undefined },
        planId,
        membership.role,
      );
      // Primed here, inside apiHandler's try/catch, so a lost approval race
      // (or any other pre-stream error) still returns a normal JSON error
      // response — see streaming-handler.ts's doc comment.
      const first = await generator.next();

      return createSseStream(generator, first);
    },
    { limit: 20, windowSeconds: 60 },
  ),
);
```

Note what this route does *not* do: it never calls `roleSatisfies` itself, never reads
`ApprovalRequest.requiredRole`, and never decides pass/fail on the caller's role. `requireRole(...,
ROLES.MEMBER)` is only a floor — enough to prove the caller belongs to the organization at all and to
obtain their `membership.role` — the real, plan-specific check happens exactly once, inside
`ApprovalService.approve()`, as the first line of `executeApprovedPlan`. Duplicating that check here
would be a second source of truth for the same decision; the route instead resolves what it's allowed
to resolve locally (identity, org, caller's role) and lets the gate decide.

### `POST /api/execution/[id]/reject`

```ts
/**
 * Declines a proposed plan — the atomic PENDING -> REJECTED transition
 * (`ApprovalService.reject`) is what actually blocks `/approve` from ever
 * succeeding for this plan afterward. No role check beyond org membership:
 * rejecting only prevents a write, it can never cause one, so any member of
 * the org may decline it.
 */
export const POST = apiHandler<Context>(async (request, { params }) => {
  assertSameOrigin(request);
  const organizationId = await requireActiveOrganizationId();
  const { id } = await params;

  await getApprovalService().reject(organizationId, id);

  return apiSuccess(null);
});
```

Deliberately asymmetric with `/approve`: no `requireRole` call at all (org membership, established by
`requireActiveOrganizationId`, is sufficient), no rate limiting, and a plain JSON `apiSuccess`
response rather than an SSE stream — rejecting is a single, synchronous, no-side-effect-beyond-status
write, not a multi-step execution that needs progress events. The same `transitionApprovalRequest`
atomicity that protects `/approve` protects `/reject` too: a plan already `APPROVED` (or already
`REJECTED`) fails the same conditional `updateMany` and surfaces as `ConflictError`, so `/reject` can't
un-approve a plan that already started executing.

## Reusing `createSseStream` — the exact same transport as Mr. Bond's chat route

`/approve` does not implement its own streaming response. It calls the same generic helper Mr. Bond's
`/api/bond/chat` route uses, unmodified:

```ts
export function createSseStream<T>(generator: AsyncGenerator<T>, primed: IteratorResult<T>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const enqueue = (event: T | { type: 'error'; message: string }) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        if (!primed.done) {
          enqueue(primed.value);
          for await (const event of generator) {
            enqueue(event);
          }
        }
      } catch (error) {
        const message = isAppError(error) ? error.message : 'Something went wrong.';
        log.error('Stream error', { message: error instanceof Error ? error.message : String(error) });
        enqueue({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
    async cancel() {
      await generator.return(undefined as never).catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
```

`createSseStream` is generic over the event type (`T`) precisely so it can carry both Mr. Bond's
`BondStreamEvent` union and Phase 6's `ExecutionStreamEvent` union with zero feature-specific code. Both
routes follow the identical two-line handoff pattern:

```ts
// /api/bond/chat
const generator = runBondChatPipeline(organizationId, user.id, body);
const first = await generator.next();
return createSseStream(generator, first);
```

```ts
// /api/execution/[id]/approve
const generator = getExecutionService().executeApprovedPlan(
  { organizationId, userId: user.id, conversationId: plan?.conversationId ?? undefined },
  planId,
  membership.role,
);
const first = await generator.next();
return createSseStream(generator, first);
```

Both `runBondChatPipeline` and `executeApprovedPlan` are async generators; both routes prime the
generator with one `generator.next()` call *before* handing it to `createSseStream`, and both do it
inside `apiHandler`'s try/catch. That priming call is what makes a pre-stream failure — an auth error,
a validation error, or here specifically a lost approval race (`ConflictError` from
`ApprovalService.approve`) — come back as an ordinary JSON error response with the right HTTP status,
rather than as a `200` response whose body silently starts with an SSE `error` event. Only errors that
happen *after* that first successful yield are caught inside `createSseStream` itself and emitted as an
in-stream `{ type: 'error' }` event, because by then response headers have already been sent and the
HTTP status can no longer change. This split is `streaming-handler.ts`'s own stated design, and it
applies identically to both routes because both hand the exact same generator/primed-result shape to
the exact same function.

The consequence for `/approve` specifically: everything after the approval gate — plan-hash
verification, step execution, rollback on failure — streams to the client as
`ExecutionStreamEvent`s (`execution_started`, `step_started`, `step_succeeded`, `step_failed`,
`rollback_started`, `rollback_succeeded`/`rollback_failed`, `execution_done`/`execution_failed`) using
transport infrastructure that Phase 6 did not have to write, test, or reason about independently —
`createSseStream`'s cancellation handling (`generator.return()` on client disconnect), header set, and
pre-stream/in-stream error split were already proven out by Mr. Bond's chat route in Phase 5.

## What's deliberately not built

- **No signed or bearer approval tokens.** No HMAC, no JWT, no secret-derived credential anywhere in
  this flow — see "Why not an HMAC-signed token" above for the specific reasoning.
- **No out-of-band approval channel.** No emailed magic link, no Slack-button callback, no webhook from
  another service. Approving a plan requires an authenticated, same-origin session against
  `/api/execution/[id]/approve` — there is no code path that approves a plan from outside the app.
- **No multi-approver / quorum approval.** A single successful `approve()` call is sufficient regardless
  of organization size or plan severity; there is no "requires 2 of 3 admins" concept.
- **No approval delegation or reassignment.** Any member whose live role satisfies `requiredRole` may
  approve — there's no concept of a specific assigned approver, and no way to hand a pending approval
  to someone else.
- **No per-plan or per-tool configurable expiry.** `APPROVAL_EXPIRY_MINUTES` is one global value for
  every organization and every plan; a tool cannot request a longer or shorter approval window for
  itself.
- **No push notification or webhook when a plan enters `AWAITING_APPROVAL` or expires.** Expiry is
  swept opportunistically (`expireStaleApprovalRequests`, called on every lookup) rather than by a
  background worker or scheduled job — the same "no real worker loop, checked on access" honesty
  already established for `SyncJob`/`EmbeddingJob` in earlier phases.
- **No partial or step-level approval.** `ApprovalRequest` gates the whole plan; there is no way to
  approve some steps of a multi-step plan and reject others.

## Phase 8: Workflow Integration

Phase 8 (docs/workflows.md) adds a third originator of an `ExecutionPlan` — a `WorkflowRun`'s own
`INVOKE_TOOL` step — alongside Mr. Bond's `<<ACTION:...>>` marker (Phase 6) and an agent's own action
proposal (Phase 7). Nothing in this section changes anything documented above: it covers what gets
*added around* the unmodified Phase 6 gate, not a modification to it.

### The same `proposeAction()`/`ApprovalRequest`/`ExecutionService` chain, exactly

`invoke-tool.handler.ts`'s own doc comment states the invariant directly:

```ts
/**
 * INVOKE_TOOL — the ONE way a workflow reaches a write: calls the same
 * `proposeAction()` Mr. Bond's `<<ACTION:...>>` marker and Phase 7's agent
 * ACTION-marker handling already use. Never executes anything itself —
 * always returns `waiting_approval`; the run stays paused until a human
 * approves via the unmodified `/api/execution/[id]/approve`, matching the
 * spec's own diagram exactly: Workflow -> Execution Plan -> P6 Action
 * Engine -> Approval -> Execution.
 *
 * Params: `{ __toolKey: string, __version?: string, ...toolParams }` for a
 * single-tool call, or `{ __plan: { summary, steps } }` for a compound
 * multi-step plan — mirroring `PlanRequestInput`'s own discriminated shape.
 */
export const invokeToolHandler: WorkflowStepHandler = {
  stepType: 'INVOKE_TOOL',
  async execute(ctx: WorkflowStepHandlerContext, params) {
    if (!ctx.ownerId) {
      throw new ValidationError('INVOKE_TOOL requires this workflow to have an owner — set one before publishing.');
    }

    const plan = params.__plan;
    const request = plan && typeof plan === 'object'
      ? { kind: 'compound' as const, ...(plan as { summary: string; steps: unknown[] }) }
      : buildSingleToolRequest(params);

    const proposed = await proposeAction({ organizationId: ctx.organizationId, userId: ctx.ownerId }, request as Parameters<typeof proposeAction>[1]);

    return { kind: 'waiting_approval', planId: proposed.plan.id };
  },
};
```

`proposeAction` is the identical function this doc's own "Documentation index" already names as the
function "both Mr. Bond's in-pipeline action handling and `POST /api/execution/plan` share"
(docs/planner.md) — Phase 8 doesn't add a fourth variant, it becomes a third caller of the same one.
The `ExecutionPlan` this produces, the `ApprovalRequest` `requestApproval` creates for it, and every
mechanism this document already covers — the atomic `updateMany`, `planHash` verification,
server-computed `requiredRole`, `APPROVAL_EXPIRY_MINUTES` — apply to a workflow-originated plan with
**zero special-casing**. An approver looking at a pending `ApprovalRequest` cannot tell, from the
approval gate's own code path, whether the plan behind it came from a chat message, an agent's turn,
or a workflow step — that symmetry is the entire point.

`INVOKE_TOOL` requires the workflow to have an `ownerId` (`ctx.ownerId`, propagated from
`WorkflowDefinition.ownerId`) — the accountable party `proposeAction` runs as. A workflow with no owner
cannot publish a graph containing an `INVOKE_TOOL`/`INVOKE_AGENT` step at all
(`WorkflowDefinitionService.publish`'s own check, docs/workflows.md) — this is caught long before a
run ever reaches this handler, not discovered as a runtime error mid-execution.

### `WorkflowRun` pauses as `WAITING_APPROVAL`

The handler's return value, `{ kind: 'waiting_approval', planId }`, is what the re-entrant driver
(`workflow-run.service.ts`'s `driveWorkflowRun`, docs/workflows.md) does with it:

```ts
case 'waiting_approval':
  await updateWorkflowRunStep(stepRow.id, { status: 'WAITING_APPROVAL', planId: outcome.planId });
  await updateWorkflowRunStatus(run.id, definition.organizationId, { status: 'WAITING_APPROVAL' });
  return;
```

The step row records the `planId` it's waiting on, the whole `WorkflowRun` is marked
`WAITING_APPROVAL`, and `driveWorkflowRun` returns immediately — exactly like a `WAIT`/`DELAY` step
pausing at `WAITING_TIMER` (docs/scheduling.md), just waiting on a human decision instead of a clock.
On a later re-entry into the same run, the driver checks whether that wait is over before doing
anything else:

```ts
if (stepRow.status === 'WAITING_APPROVAL') {
  const resolution = await tryResolveWaitingApproval(stepRow, definition.organizationId);
  if (resolution.kind === 'still_waiting') {
    await updateWorkflowRunStatus(run.id, definition.organizationId, { status: 'WAITING_APPROVAL' });
    return;
  }
  if (resolution.kind === 'failed') {
    await failStep(stepRow, resolution.error);
    await failRun(definition, run, stepRow.key, resolution.error, existingSteps);
    return;
  }
  stepRow = { ...stepRow, status: 'SUCCEEDED', output: resolution.output };
  ...
}
```

`tryResolveWaitingApproval` reads the plan's `ToolExecution` (if execution has already started) or its
`ApprovalRequest` (if it hasn't) by the step's stored `planId` — `SUCCEEDED` execution resolves the
step `SUCCEEDED`; a `FAILED`/`ROLLED_BACK` execution or a `REJECTED`/`EXPIRED` approval resolves it
`failed` (triggering docs/retries.md's `failRun`/rollback path); anything else (still `PENDING`, still
`EXECUTING`) reports `still_waiting` and the driver returns again, unchanged, ready for the next
re-entry.

### The route-layer resume hook: cross-phase awareness lives in the route, not in `execution.service.ts`

Something has to notice when a plan a workflow was waiting on finishes, and nudge that `WorkflowRun`
forward — but `ExecutionService.executeApprovedPlan` (Phase 6) has no reason to know Phase 8 exists,
and this codebase's own standing rule (stated identically for Phase 6 not knowing about Phase 7's
agents, docs/agents.md) is that a lower phase never gains awareness of a higher one. The resolution is
the same one this codebase has used before: put the cross-phase awareness in the **route**, which is
allowed to know about both, rather than in the service.
`apps/web/app/api/execution/[id]/approve/route.ts`'s own comment states this directly:

```ts
/**
 * Wraps the execution generator with a Phase-8-aware completion hook,
 * without `execution.service.ts` (P6) ever importing or knowing about
 * Phase 8 — this file (a route, allowed to know about both) is where that
 * cross-phase awareness lives. `for await`-driving the original generator
 * and re-yielding preserves `createSseStream`'s exact priming/streaming
 * contract; the resume attempt only runs once the underlying generator is
 * exhausted, and never throws into the SSE stream itself (best-effort,
 * matching every other "can't break the caller" event hook in this phase).
 */
async function* withWorkflowResumeHook<T>(
  generator: AsyncGenerator<T>,
  planId: string,
  organizationId: string,
): AsyncGenerator<T> {
  try {
    yield* generator;
  } finally {
    try {
      await resumeWorkflowRunByPlanId(planId, organizationId);
    } catch (error) {
      log.error('Workflow resume-on-approval failed', { planId, organizationId, message: error instanceof Error ? error.message : String(error) });
    }
  }
}
```

The route's `POST` handler is otherwise character-for-character the same as the Phase 6 section above
— same `assertSameOrigin`, same `requireAuth`/`requireRole(..., ROLES.MEMBER)` floor, same
`getExecutionService().executeApprovedPlan(...)` call — with exactly one addition: the raw generator is
wrapped before being handed to `createSseStream`:

```ts
const rawGenerator = getExecutionService().executeApprovedPlan(
  { organizationId, userId: user.id, conversationId: plan?.conversationId ?? undefined },
  planId,
  membership.role,
);
const generator = withWorkflowResumeHook(rawGenerator, planId, organizationId);

const first = await generator.next();
return createSseStream(generator, first);
```

`withWorkflowResumeHook` is a pass-through async generator — `yield* generator` re-yields every event
`executeApprovedPlan` produces completely unchanged, so `createSseStream`'s priming/streaming contract
(docs/approvals.md's Phase 6 section, "Reusing `createSseStream`") is preserved exactly: the client
sees the identical SSE stream it always would have, with identical pre-stream-vs-in-stream error
handling. The resume attempt happens in a `finally` block, meaning it runs once the underlying
generator is fully exhausted — after execution has completed (successfully or not) and every
`execution_*`/`step_*`/`rollback_*` event has already been yielded — never interleaved with or ahead
of that stream.

`resumeWorkflowRunByPlanId` (`workflow-run.service.ts`) is the one entry point this hook calls:

```ts
/**
 * The route-layer approval-resume hook's one entry point (Phase 8 §2 —
 * `POST /api/execution/[id]/approve` calls this after its own SSE stream
 * completes, best-effort). Resolves the `WorkflowRunStep` a just-approved
 * `planId` belongs to (if any — most approvals are NOT workflow-originated)
 * and re-drives that run. A no-op, not an error, when `planId` doesn't
 * belong to any workflow.
 */
export async function resumeWorkflowRunByPlanId(planId: string, organizationId: string): Promise<void> {
  const step = await getWorkflowRunStepByPlanId(planId);
  if (!step || step.run.organizationId !== organizationId) return;
  ...
}
```

`getWorkflowRunStepByPlanId` is a plain lookup against `WorkflowRunStep.planId` — the common case,
"most approvals are NOT workflow-originated," is a `null` result and an immediate, silent no-op. There
is no error, no wasted work beyond one indexed query, and no behavioral difference for a Phase 6/7
human- or agent-proposed plan approved through this exact same route. When it *does* find a match, it
re-derives the `WorkflowDefinition` and the run's original triggering `Event`, builds a fresh
`WorkflowDispatchBudget`, and calls `resumeWorkflowRunById` — the identical re-entrant driver entry
point the tick endpoint uses to resume a `WAITING_TIMER` step (docs/scheduling.md), just triggered by
an approval completing instead of a clock passing.

The `try`/`catch` around this call inside `withWorkflowResumeHook` means a failure in the resume
attempt itself — a bug, a transient DB error — is logged (`log.error('Workflow resume-on-approval
failed', ...)`) and swallowed, never thrown into the SSE stream the client is reading. This matches
"every other 'can't break the caller' event hook in this phase" (the same posture `publishEvent()`'s
own dispatch failure handling takes, docs/event-bus.md): approving a plan must always succeed or fail
on its own terms, regardless of whether some workflow happens to be waiting on it.

### What `execution.service.ts` itself still knows about Phase 8: nothing

Worth stating as plainly as the rest of this section: `apps/web/features/execution/services/execution.service.ts`
has no Phase 8 import, no `WorkflowRun`/`WorkflowRunStep` reference, and no branch of any kind that
behaves differently for a workflow-originated plan versus any other. The only schema-level
acknowledgment that a `ToolExecution` might have come from a workflow is a single nullable, `@unique`
foreign key added to the model — `ToolExecution.workflowRunStepId` — read by nothing inside
`execution.service.ts` itself:

```prisma
/// Phase 8: set only when this execution was submitted by a Workflow's
/// Invoke-Tool step (via the same `proposeAction()` every other caller
/// uses — no separate write path). How the `/api/execution/[id]/approve`
/// route-layer hook identifies "resume this WorkflowRun after executing" —
/// see docs/workflows.md. Null for every non-workflow execution.
workflowRunStepId String? @unique
```

This is the same architectural discipline this document's Phase 6 section already demonstrated for
"no call site anywhere writes `new ExecutionService(...)` directly" — checkable, not just claimed: a
grep for `workflow` (case-insensitive) inside `apps/web/features/execution/` turns up nothing. Every
piece of Phase 8-specific behavior — pausing a run, resolving a waiting step, resuming after approval
— lives in `apps/web/features/workflows/` and the one route file allowed to bridge the two, never in
the Phase 6 service the rest of this document describes.
