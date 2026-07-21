# Approval Security: The Atomic Single-Use Transition

## Scope

This document answers one question in depth: **how does BOND OS guarantee that a single
`ApprovalRequest` can be consumed exactly once, under concurrency, without a signed or bearer
token?** It is the security-property companion to
[Workflow Engine → Approvals](../workflows/approvals.md), which documents the Approval Engine's
full mechanics (the service, the routes, the SSE transport, Phase-8 workflow integration). This
document assumes that context and focuses narrowly on the concurrency/replay guarantee and the
design reasoning behind it — reasoning that is recorded directly in the source, not just inferred:
the same explanation appears, near-verbatim, in three independent places in the codebase —
`ApprovalService`'s own class comment, the `ApprovalRequest` Prisma model's schema comment, and
`transitionApprovalRequest`'s own function comment — each pointing back at this documentation.

## The property being guaranteed

An `ApprovalRequest` is the single gate between a proposed plan and every write BOND OS's
[Tool Execution Framework](../workflows/workflow-engine.md) can perform. Two properties must hold
for that gate to mean anything:

1. **Single-use.** Once a plan has been approved (or rejected), no later request — a replay, a
   double-click, a retried network request — can approve it again or flip its outcome.
   `ExecutionService.executeApprovedPlan`'s first statement is `await
   this.approvalService.approve(...)` — nothing downstream (step execution, writes to domain
   tables) runs until that call has already succeeded exactly once.
2. **Race-safe.** Two concurrent requests attempting to approve the same plan at the same instant
   must not both succeed, and must not corrupt state in the attempt.

## The mechanism: an atomic, org-scoped conditional `updateMany`

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

(`packages/database/src/repositories/approval-requests.ts:41-64`)

The entire guard is the shape of this one query: `id`, `organizationId`, `status: 'PENDING'`, and
`expiresAt: { gt: new Date() }` all sit in the same `where` clause as the write itself, and the
write only lands if that `where` still matches at the moment Postgres evaluates it. Two callers
racing to approve the identical plan both issue this exact `updateMany`; the database — not
application code — decides which one's write commits first. The loser's `where` no longer matches
(`status` has already flipped away from `'PENDING'`), so its `count` comes back `0`.
`ApprovalService.approve`/`.reject` read that boolean back and translate a loss into
`ConflictError` (`packages/database/src/repositories/approval-requests.ts` header comment; see
`approve()`'s own logic below) — never a silent no-op, never a second write.

The repository file's own comment states the alternative this replaces, explicitly: **"never a
plain `findFirst` + `update` pair, which would race."** A separate read-then-write is exactly the
shape that lets two concurrent requests both observe `status: 'PENDING'` before either one writes —
the classic time-of-check-to-time-of-use (TOCTOU) bug. Folding the check and the write into one
conditional `updateMany` closes that window entirely; there is no gap in which two callers can both
believe they're the one making the transition.

```ts
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
```

(`apps/web/features/approvals/services/approval.service.ts:68-93`, elided)

Note the shape: the initial `getApprovalRequestByPlanId` lookup is a plain, non-atomic read — but
it is never trusted as the authorization decision. It only fetches the row's `requiredRole` for the
role check and the row's `id` to pass to the atomic transition. **The actual "is this still
approvable" decision is made exactly once, inside the database, by `transitionApprovalRequest`'s
`where` clause** — the earlier read cannot go stale in a way that matters, because nothing
downstream acts on its `status` field.

### Opportunistic expiry sweep

```ts
export async function expireStaleApprovalRequests(organizationId: string): Promise<number> {
  const result = await prisma.approvalRequest.updateMany({
    where: { organizationId, status: 'PENDING', expiresAt: { lte: new Date() } },
    data: { status: 'EXPIRED' },
  });
  return result.count;
}
```

(`approval-requests.ts:67-73`) — the identical `updateMany` pattern, applied to expiry instead of
approval. Called at the top of both `getForPlan` and `approve`, so a row that is technically still
`PENDING` in the database but past its `expiresAt` gets flagged `EXPIRED` before anything else runs.
This is belt-and-suspenders, not the only expiry enforcement: even if this sweep hadn't run yet
(there is no background worker — see below), `transitionApprovalRequest`'s own `expiresAt: { gt:
new Date() }` clause independently refuses a stale row. Both checks read the same `expiresAt`
column; neither can drift out of sync with the other.

There is **no scheduled job** that sweeps expired approvals — this is the same "no real worker
loop, checked on access" posture documented for `SyncJob`/`EmbeddingJob` and for the workflow
scheduler's own time-based triggers (see [Scheduler](../workflows/scheduler.md)). An
`ApprovalRequest` sitting `PENDING` past its `expiresAt` with nobody looking at it simply stays that
way in the database until the next read — but it can never be *approved* past expiry regardless,
because the atomic transition's own `where` clause checks `expiresAt` independently of whether the
sweep has run.

## Why not a signed/HMAC token

A natural first design for "prove this approval is genuine and hasn't been used before" is a
signed, bearer-style token: sign `{ planId, organizationId, requiredRole, expiresAt }` with a server
secret, hand the signature to the approver, and verify it on `/approve` instead of — or alongside —
a database lookup. That shape earns its keep where the approver is off-system: a magic link
mailed to someone, a webhook callback from another service, anywhere verification needs to happen
without a trusted, stateful lookup on the verifying side.

It was considered for BOND OS and dropped, for three concrete reasons — each maps directly onto a
mechanism this codebase uses instead:

### 1. A signature cannot provide single-use/replay protection on its own

HMAC verification proves a token's *claims* weren't altered; it says nothing about whether that
exact, still-valid token has already been redeemed. Two concurrent requests presenting the
identical signed token both pass verification — nothing about the cryptography changes between the
first and second check. Solving that requires a server-side "already consumed" flag, checked and
set atomically — which is exactly what `transitionApprovalRequest`'s conditional `updateMany`
already is. Once that atomic state transition exists — and it has to exist regardless, because
it's the only thing that can make "only once" true under concurrency — a signature would be a
second, independent mechanism for a property the database transition already fully owns.

### 2. There is no off-system channel in this flow for a signature to authenticate across

`/approve` and `/reject` run inside an authenticated, same-origin session — `requireAuth()` /
`requireRole()` resolve the caller's identity and role from their session, and
[`assertSameOrigin`](./threat-model.md#csrf-cross-site-request-forgery) confirms the request itself
originated from BOND OS's own frontend. There is no emailed link, no cross-service webhook, no
detached bearer credential that needs to prove its own provenance the way a JWT would for, say, a
password-reset email (see [Secrets Management](./secrets.md) for how that email flow's *own* token
is handled). The caller is already a known, authenticated organization member by the time
`approve()` runs; what remains to check is whether *that* caller's live role is high enough —
answered directly by `roleSatisfies(callerRole, approval.requiredRole)` against the row. A signature
here would only be re-proving something the session already proved.

### 3. The values a token would protect from tampering are never client-supplied in the first place

A signed token's real job is stopping a client from handing back a claim the server didn't
originally issue — e.g., a forged `requiredRole: MEMBER` on a plan that actually needs `ADMIN`.
In BOND OS, `requiredRole` is computed server-side by `PermissionService.requiredRoleForTools` at
plan-build time and stored on the `ApprovalRequest` row itself; `approve()` never reads a role,
plan hash, or expiry from the request body or the URL — **the URL supplies only `planId`**, used
purely to look the authoritative row up server-side. There is no claim in this flow that travels
through the client and back that a signature would need to protect.

### What replaced it

| What a signature would protect | What BOND OS uses instead |
|---|---|
| Single-use / replay | The atomic, org-scoped conditional `updateMany` above |
| Plan content tampering ("has this changed since approval?") | `planHash` — a plain SHA-256 digest recomputed and compared at execution time (see below) |
| Authorization-level tampering ("was `requiredRole` lowered?") | `requiredRole` computed server-side once, at plan-build time, never client-supplied or re-derived |

Put together: single-use/replay is a concurrency problem, solved by an atomic database transition,
not a cryptography problem — and the "was this tampered with" question a signature answers is moot
when nothing security-relevant ever leaves the server and comes back. What a signed token would
have added — key management, a signing/verification code path, and a new class of bug (constant-
time comparison, algorithm confusion, an independently-driftable duplicate expiry claim) — would
have bought no property this design didn't already have.

## `planHash`: the plan-integrity guard a signature would otherwise provide

```ts
if (this.plannerService.hashSteps(stepDefs) !== plan.planHash) {
  throw new ConflictError('This plan changed since it was approved. Please build and approve a new plan.');
}
```

(`apps/web/features/execution/services/execution.service.ts:63-65`) — the second statement after
the approval gate itself. `hashSteps` recomputes a plain, unsigned SHA-256 digest (via
`@bond-os/parsers`' `hashContent`, the same primitive `Chunk.contentHash` uses for re-sync change
detection — no secret involved) over the plan's canonicalized step-identity fields, and compares it
against `ExecutionPlan.planHash`, written once at plan-build time and never updated again. A
mismatch hard-fails execution rather than running a possibly-tampered or since-mutated plan. No
secret is involved because the property being verified isn't "prove you're allowed to produce this
hash" (that's the approval gate's own job) — it's "prove `steps` is byte-for-byte what it was when
the plan was hashed," and a plain digest compared server-side, against a value only the server
itself ever wrote, already delivers that. `steps` is never re-supplied by the client at execution
time either — it's read straight back off the `ExecutionPlan` row by `planId`.

## `requiredRole`: computed server-side, never client-supplied

```ts
requiredRoleForTools(tools: AnyToolDefinition[]): Role {
  let required: Role = ROLES.MEMBER;
  for (const tool of tools) {
    const role = tool.permissions();
    if (ROLE_HIERARCHY[role] > ROLE_HIERARCHY[required]) required = role;
  }
  return required;
}
```

Each tool declares its own fixed minimum via `permissions()`. `requiredRoleForTools` walks every
tool in a plan and keeps the highest severity seen — a plan mixing a `MEMBER`-tier step with an
`ADMIN`-tier step ends up requiring `ADMIN` to approve, because one under-privileged step is enough
to raise the whole plan's bar. `PlannerService` calls this once, at plan-build time, and writes the
result onto `ApprovalRequest.requiredRole` via `requestApproval`. Nothing downstream recomputes or
accepts an override for it. `approve()`'s role check compares this stored value against the
*caller's live, freshly re-looked-up* membership role (`callerRole`, sourced from the `/approve`
route's own `requireRole(organizationId, ROLES.MEMBER)` floor check against the session) — never
anything the client could have supplied directly.

## `APPROVAL_EXPIRY_MINUTES`

```ts
APPROVAL_EXPIRY_MINUTES: z.coerce.number().int().positive().default(15),
```

(`packages/shared/src/env.ts:82-84`) — one global value for every organization and every plan,
defaulting to 15 minutes. `requestApproval` is its only reader; `expiresAt` is computed once, at
`ApprovalRequest` creation time, and stored as a plain `DateTime` column — never recomputed,
extended, or reset by any later call. There is no per-plan or per-tool configurable expiry window
today.

## Asymmetric route-level protections

`/approve` and `/reject` are deliberately **not** symmetric, because approving causes a write and
rejecting can only prevent one:

- **`POST /api/execution/[id]/approve`** — `assertSameOrigin`, `requireAuth`, `requireRole(...,
  ROLES.MEMBER)` (a floor, not the real check — see [Approval Engine](../workflows/approvals.md)),
  and rate-limited at 20 requests/60s.
- **`POST /api/execution/[id]/reject`** — `assertSameOrigin`, org membership only (via
  `requireActiveOrganizationId`), and **not** rate-limited. Confirmed directly: no
  `withRateLimit` wrapper appears in `apps/web/app/api/execution/[id]/reject/route.ts`.

Both routes still rely on the same underlying atomic transition for correctness — a plan already
`APPROVED` (or already `REJECTED`) fails the identical conditional `updateMany` if either route is
called again, surfacing as `ConflictError` either way. `/reject` cannot un-approve a plan that has
already started executing, and a lost race on either route never corrupts `ApprovalRequest.status`
into an inconsistent value — it always lands on whichever terminal state won.

## What this design does not protect against

Stated plainly, since a security document should be explicit about its own boundaries:

- **It does not protect against a legitimate, sufficiently-privileged organization member
  approving a plan they shouldn't have.** `roleSatisfies` checks role, not judgment — there is no
  reviewer-diversity requirement, no "the proposer cannot also approve" rule, and no multi-approver
  quorum. Any member whose live role meets `requiredRole` may approve, alone. See
  [Threat Model](./threat-model.md) for how this composes with the rest of BOND OS's controls.
- **It does not protect against a compromised session.** If an attacker has a valid, authenticated
  session for a sufficiently-privileged user (via a stolen cookie, an XSS payload, etc.), the
  approval gate itself offers no additional resistance — session integrity is Better Auth's/`
  packages/auth`'s responsibility, not this gate's. See [Threat Model](./threat-model.md).
- **It does not protect against the underlying tool's own logic being wrong.** The gate confirms
  *who* may authorize a write and that the *plan content* hasn't changed since approval — it makes
  no claim about whether the tool's `execute()` implementation itself is correct.

## What's deliberately not built

- **No signed or bearer approval tokens.** See "Why not a signed/HMAC token" above.
- **No out-of-band approval channel.** No emailed magic link, no chat-app button callback, no
  webhook from another service — approving requires an authenticated, same-origin session against
  `/api/execution/[id]/approve`.
- **No multi-approver / quorum approval.** A single successful `approve()` call is sufficient
  regardless of organization size or plan severity.
- **No approval delegation or reassignment.** Any member whose live role satisfies `requiredRole`
  may approve; there is no concept of a specifically assigned approver.
- **No per-plan or per-tool configurable expiry.**
- **No push notification or webhook when a plan enters `AWAITING_APPROVAL` or expires** — expiry is
  swept opportunistically, not by a background worker.
- **No partial or step-level approval.** `ApprovalRequest` gates the whole plan.

## Related documents

- [Workflow Engine → Approvals](../workflows/approvals.md) — the full Approval Engine mechanics:
  the service's four methods, the HTTP routes in full, SSE transport reuse, and Phase-8 workflow
  integration (`INVOKE_TOOL`, `WAITING_APPROVAL`, the route-layer resume hook).
- [Threat Model](./threat-model.md) — replay attacks on approvals as one thread among several,
  cross-referenced against CSRF, cross-tenant access, and privilege escalation.
- [Audit Trail](./audit.md) — how the `'approved'` transition is recorded once it succeeds.
- [Authorization](./permissions.md) — `roleSatisfies`, `ROLE_HIERARCHY`, and `requireRole` in full.
