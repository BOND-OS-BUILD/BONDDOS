# Architecture

## Scope

This document covers **Phase 0** of BOND OS: the core platform foundation. It contains no AI logic —
the goal is a production-ready base that every future module (Knowledge Graph, Company Memory, AI
Brain, Search, Agents, Automations) can be built on without re-litigating auth, multi-tenancy,
database access, error handling, or the component kit.

## Monorepo shape

pnpm workspaces (`apps/*`, `packages/*`) orchestrated by Turborepo, which caches and parallelizes
`build`/`lint`/`typecheck`/`dev` across packages based on their dependency graph.

Internal packages (`@bond-os/config`, `@bond-os/shared`, `@bond-os/database`, `@bond-os/auth`,
`@bond-os/ui`) are consumed as **TypeScript source**, not pre-built artifacts: each package's
`package.json` points `main`/`exports` straight at `src/*.ts`, and `apps/web/next.config.ts` lists
them under `transpilePackages`. There's no per-package build step or TypeScript project-references
graph to keep in sync — Next.js's own compiler transpiles workspace source directly. The one
exception is `@bond-os/database`, where `prisma generate` emits the Prisma Client into
`packages/database/src/generated` (gitignored) — that's the only generated-artifact step in the repo.

```
apps/web        Next.js 15 App Router application — pages, API routes, dashboard shell
packages/config  Shared tsconfig / ESLint / Tailwind presets (build-time only, no runtime code)
packages/shared  Cross-cutting infrastructure: env validation, logging, error types, cache,
                 rate-limit, zod schemas, shared TS types
packages/database Prisma schema, generated client, seed script, and a couple of reusable
                 multi-model queries (e.g. "create an org with its workspace + owner membership")
packages/auth    Better Auth server + client configuration, session/authorization helpers,
                 password-reset email provider
packages/ui      Hand-authored shadcn/ui-style component library (Radix primitives + cva)
```

## Data model

### Organizations are many-to-many with users

The product brief describes a user who can "own multiple organizations," which a flat
`organizationId`/`role` pair on `User` can't express (a scalar field only ever points at one row).
Phase 0 instead uses the standard SaaS multi-tenancy shape:

```
User ──< Membership >── Organization ──1:1── Workspace
             │
             └─ role: OWNER | ADMIN | MEMBER   (per-organization, not global)
```

`Membership` is the join table (`userId`, `organizationId`, `role`, unique on the pair). A user's role
is always evaluated **for a specific organization** — see `requireRole(organizationId, minimumRole)`
in `packages/auth/src/session.ts`. `Workspace` is 1:1 with `Organization` (unique `organizationId`)
and auto-created in the same transaction as the organization
(`createOrganizationWithWorkspace` in `packages/database/src/queries/organizations.ts`) — every
future module attaches to a workspace, not directly to an organization.

### Better Auth's tables

`User`, `Session`, `Account`, `Verification` follow Better Auth's default Prisma shape exactly (field
names, types) so its Prisma adapter works with zero custom field mapping. The one product-naming
requirement — an `avatar` field instead of Better Auth's default `image` — is satisfied without
touching Better Auth's config: the Prisma field is still named `image` (so Better Auth's JS-level
property access is untouched) but `@map("avatar")`s the underlying SQL column, and the API layer
renames `image` → `avatar` at the DTO boundary (see any `apps/web/app/api/**/route.ts` that returns a
user). `Account.password` (not `User.password`) holds the credential provider's hashed password —
Better Auth owns hashing/verification end-to-end; nothing in this codebase touches it directly.

## Auth & authorization

- **Better Auth** (`packages/auth/src/server.ts`) handles sign up, login, logout, and forgot/reset
  password via its `emailAndPassword` provider and the Prisma adapter. Its Next.js route handler is
  mounted at `apps/web/app/api/auth/[...all]/route.ts`.
- **Session cookies** are httpOnly, `sameSite: lax`, and secure in production (Better Auth's
  `advanced.useSecureCookies`), with a 7-day expiry and a 5-minute in-memory cookie cache to avoid a
  DB round-trip on every request.
- **Route protection** happens at two layers: `apps/web/middleware.ts` does a fast, Edge-safe redirect
  based on session-cookie *presence* (no DB hit — via Better Auth's `getSessionCookie`), while every
  Server Component/Route Handler that actually needs the session calls `requireAuth()` /
  `requireRole(organizationId, role)` (`packages/auth/src/session.ts`), which is the authoritative,
  DB-backed check. The middleware is a UX optimization, not the security boundary.
- **Authorization** is role-based and per-organization (`OWNER > ADMIN > MEMBER`, via
  `roleSatisfies` in `packages/shared/src/constants.ts`). API routes additionally guard against
  privilege escalation (an ADMIN can't promote anyone to OWNER or modify an existing OWNER's
  membership) and against removing an organization's last OWNER.
- **CSRF**: Better Auth's own endpoints are protected via `trustedOrigins`. BOND OS's own mutating API
  routes (`/api/user`, `/api/organization`, `/api/workspace`) call `assertSameOrigin(request)`
  (`apps/web/lib/csrf.ts`), which verifies the browser-set `Origin` header matches the app's own URL —
  the same mitigation Next.js Server Actions use internally, chosen over hand-rolled double-submit
  tokens because it covers the same threat model (same-origin SPA, no public write API) with far less
  surface area to get wrong.

## Error handling

A single typed error hierarchy (`AppError` and subclasses — `ValidationError`, `AuthError`,
`ForbiddenError`, `NotFoundError`, `ConflictError`, `RateLimitError` — in `packages/shared/src/errors.ts`)
flows through one place: `apiHandler()` (`apps/web/lib/api-handler.ts`) wraps every Route Handler,
catches `AppError`/`ZodError`/anything else, and returns a consistent
`{ success, data } | { success: false, error }` JSON envelope with the right HTTP status. Route
handlers just `throw` instead of manually constructing error responses. Unexpected (non-`AppError`)
failures are logged via the centralized logger and returned as a generic 500 — internal details never
leak to the client. On the frontend, `app/error.tsx` (route-segment error boundary), `app/not-found.tsx`
(404), and `app/global-error.tsx` (root-layout failures) cover the equivalent cases for page renders.

## Logging

`packages/shared/src/logger.ts` wraps `pino` behind a small `Logger` interface
(`info`/`warn`/`error`/`debug`/`child(scope)`). Every subsystem gets its own namespace via
`logger.child('scope')` (e.g. `'auth'`, `'email'`, `'api'`, `'storage'`) so future AI/agent logging
can plug into the exact same structured pipe rather than introducing a second logging path.

## Caching & rate limiting

Both are **interfaces first, implementations second** — nothing in Phase 0 actually needs caching or
distributed rate limiting yet, but the seams exist so later modules (Search, Memory) don't have to
invent them:

- `Cache` (`packages/shared/src/cache.ts`): a zero-config `InMemoryCache` by default; set `REDIS_URL`
  and `getCache()` transparently returns a Redis-backed implementation instead — no call-site changes.
- `RateLimiter` (`packages/shared/src/rate-limit.ts`): an in-memory fixed-window limiter plus a
  `withRateLimit()` Route Handler wrapper, ready to swap for a Redis-backed implementation the same
  way once running more than one instance.

## Storage

`apps/web/lib/supabase.ts` wraps `@supabase/supabase-js` behind a single `uploadPublicFile(folder,
filename, file)` helper used for avatar and organization-logo uploads. Uploads are proxied through our
own API routes (`/api/user/avatar`, `/api/organization/[id]/logo`) rather than uploaded directly from
the browser to Supabase, so file-type/size validation and auth/role checks happen server-side before
anything is written to storage.

## Frontend state

Server data (users, organizations, memberships) is always fetched fresh via Server Components or
Route Handlers — there's no client-side data cache to keep in sync. **Zustand** is used narrowly for
genuinely client-only UI state that should survive navigation/reload (`ui-store`: sidebar collapsed;
`org-store`: a client-side mirror of the active organization for instant UI feedback). The actual
source of truth for "which organization is active" is a cookie, set by a Server Action
(`setActiveOrganization` in `apps/web/app/(dashboard)/actions.ts`) and read server-side
(`apps/web/lib/organization.ts`) — this keeps Server Components (which can't read Zustand) and Client
Components in agreement without a hydration-order race.

## UI kit

`packages/ui` is a hand-authored, shadcn/ui-style component library: Radix UI primitives for
behavior/accessibility, `class-variance-authority` for style variants, `tailwind-merge` for safe
class composition. Components are copied into the repo (not installed as a compiled dependency) so
they're fully editable — consistent with shadcn/ui's "you own the code" philosophy — while still
following its exact conventions closely enough that the `shadcn` CLI could be used going forward.
Design tokens (colors, radius) are CSS variables defined once in `apps/web/app/globals.css` and
consumed via Tailwind's semantic color classes (`bg-primary`, `text-muted-foreground`, etc.), with a
light and a dark set switched by `next-themes`' `class` strategy.

## What's deliberately absent

No AI logic, Knowledge Graph, Company Memory, Search, Chat, Agents, Automation, Connectors, Analytics,
Notifications, Projects/Tasks, or CRM. Their sidebar entries exist as "coming soon" placeholders so
the navigation shape is stable for later phases, but nothing behind them is implemented yet.
