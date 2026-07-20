# Team Spaces (Phase 9)

## Scope

`apps/web/features/spaces/services/space.service.ts` and the `Space`/`SpaceMember`/`SpaceProject`/
`SpaceKnowledgeDocument`/`SpaceWorkflow`/`SpaceAgent` models. This doc states, explicitly, the one thing
most important to get right about Spaces: what they do and do not restrict.

## Spaces group and curate; they do not restrict who can see the underlying content

A Space is a named collection — a roster of members, plus links to Projects, Knowledge Documents,
Workflows, and Agents relevant to a team. It is **not** an access-control layer. `SpaceMember` does not
restrict visibility of anything: a non-member can still navigate directly to any Project linked into a
Space they're not in, because every existing read path (`getProjectService`, `getMeetingById`, etc.)
gates on organization role only, exactly as it did before this phase. Retrofitting space-aware visibility
into every Project/Document/Task/Workflow/Agent read path would be a much larger, cross-cutting change
than this phase's additive scope — and nothing in the spec asked for it.

This is a deliberate, explicitly-documented boundary, not an oversight discovered later. It avoids
repeating `ProjectMember`'s mistake: a roster table in this same codebase that reads as access control
but has never actually been checked by any authorization path, confirmed dead weight. `SpaceMember` is
built the same shape on purpose — a roster, full stop — but its non-restrictive nature is stated here
plainly instead of left ambiguous.

## Content links are soft references, not ownership transfers

```prisma
model SpaceProject {
  id        String   @id @default(cuid())
  spaceId   String
  projectId String   // no @relation — soft reference, see below
  createdAt DateTime @default(now())
  @@unique([spaceId, projectId])
}
```

`SpaceProject`/`SpaceKnowledgeDocument`/`SpaceWorkflow`/`SpaceAgent` all store their target as a plain
`String` id with **no hard FK** — mirroring `ExecutionStep.tool`'s own "resolved at runtime,
re-validated by the service layer" precedent (docs/tool-execution.md). Linking a Project into a Space
never moves its ownership; the Project stays organization-owned, and unlinking it from every Space it's
in doesn't touch the Project itself. `space.service.ts`'s `linkProjectToSpaceService` (and the three
siblings for documents/workflows/agents) validate the target actually exists in the caller's
organization before creating the link — a soft reference doesn't mean an unchecked one.

## Membership: self-service join, creator/admin-gated management

Any organization member can join any Space (`POST /api/spaces/[id]/members`) or leave one
(`DELETE /api/spaces/[id]/members/[userId]` with their own id) — no approval, matching "curation, not
ACL." Managing a Space itself — renaming it, deleting it, linking/unlinking content, or removing a
*different* member — requires being the Space's creator or an organization ADMIN+
(`assertCanManageSpace` in `space.service.ts`). This is a real, separate permission tier from the
org-role-only rule that governs reading Space content: managing curation ownership is gated; seeing
what's inside a Space (or any Space's linked content directly) is not.

## `@team` mentions resolve against Space membership

Spaces are introduced in this same phase specifically to serve as the "team" concept Comments' `@team`
mentions need (docs/comments.md) — a `@[Engineering](space:clyyy456)` token validates against
`areAllSpacesInOrganization`, and (once wired) fans a `MENTION` notification out to that Space's current
members. This is the only place Space membership feeds into another Phase 9 feature; it's still not a
visibility check, only a "who gets notified" resolution.

## What this does NOT do

- **No space-scoped content visibility.** Restated from above because it's the single most
  easy-to-assume-wrong thing about this feature: a Space is a curated view, not a boundary.
- **No space-specific role tier.** `SpaceMember` has no `role` column — every member is just "a member";
  management permission comes from being the creator or an org ADMIN+, never from a space-level role.
- **No cross-organization spaces.** `Space.organizationId` scopes every read/write the same way as every
  other org-scoped model in this codebase.
