# Folder Structure

A tour of the codebase, organized feature-first rather than type-first (no repo-wide `components/`,
`utils/`, `hooks/` dumping grounds — each package/route owns what it needs).

```
BONDOS/
├─ apps/
│  └─ web/                          Next.js 15 App Router application
│     ├─ app/
│     │  ├─ (auth)/                 Public auth route group — its own centered-card layout
│     │  │  ├─ login/page.tsx
│     │  │  ├─ signup/page.tsx
│     │  │  ├─ forgot-password/page.tsx
│     │  │  ├─ reset-password/page.tsx
│     │  │  └─ layout.tsx
│     │  ├─ (dashboard)/            Authenticated app shell
│     │  │  ├─ layout.tsx           Sidebar + topbar shell, or first-organization onboarding
│     │  │  ├─ sidebar.tsx / topbar.tsx
│     │  │  ├─ actions.ts           Server Actions (e.g. switching the active organization)
│     │  │  ├─ dashboard/page.tsx   Landing page
│     │  │  ├─ search|memory|projects|people|integrations/page.tsx   Placeholders (Phase 0 scope)
│     │  │  └─ settings/
│     │  │     ├─ layout.tsx        Settings sub-navigation
│     │  │     └─ profile|organization|members|billing|api-keys|preferences/page.tsx
│     │  ├─ api/
│     │  │  ├─ auth/[...all]/route.ts       Better Auth's handler (sign up/in/out, reset, sessions)
│     │  │  ├─ user/route.ts                GET/PATCH current user
│     │  │  ├─ user/avatar/route.ts         POST avatar upload
│     │  │  ├─ organization/route.ts        GET (list mine) / POST (create)
│     │  │  ├─ organization/[id]/route.ts   GET/PATCH/DELETE
│     │  │  ├─ organization/[id]/logo/route.ts        POST logo upload
│     │  │  ├─ organization/[id]/members/route.ts     GET (list) / POST (add)
│     │  │  ├─ organization/[id]/members/[userId]/route.ts   PATCH (role) / DELETE (remove)
│     │  │  └─ workspace/[organizationId]/route.ts    GET
│     │  ├─ layout.tsx / globals.css        Root layout, theme provider + toaster, design tokens
│     │  ├─ error.tsx / not-found.tsx / global-error.tsx   Error boundary, 404, root-failure fallback
│     │  └─ page.tsx                        Marketing/landing placeholder at "/"
│     ├─ components/
│     │  └─ theme-provider.tsx      next-themes wrapper
│     ├─ lib/
│     │  ├─ api-handler.ts          apiHandler / apiSuccess / parseJsonBody — every route uses these
│     │  ├─ csrf.ts                 assertSameOrigin — same-origin check for mutating routes
│     │  ├─ supabase.ts             uploadPublicFile — avatar/logo uploads
│     │  └─ organization.ts         getActiveOrganization — cookie-backed "current org" resolution
│     ├─ store/
│     │  ├─ ui-store.ts             Zustand: sidebar collapsed state
│     │  └─ org-store.ts            Zustand: client-side mirror of the active organization
│     ├─ middleware.ts              Edge-safe route protection (session-cookie presence check)
│     ├─ next.config.ts / tailwind.config.ts / postcss.config.js / eslint.config.mjs / tsconfig.json
│     └─ package.json
│
├─ packages/
│  ├─ config/                       No runtime code — shared build-time presets only
│  │  ├─ tsconfig.base.json / tsconfig.nextjs.json / tsconfig.react-library.json
│  │  ├─ eslint/base.mjs
│  │  └─ tailwind-preset.js         Design-token color/radius mapping, dark mode strategy
│  │
│  ├─ shared/src/
│  │  ├─ index.ts                   Client-safe barrel: constants, errors, schemas, types
│  │  ├─ server.ts                  Server-only barrel: env, logger, cache, rate-limit
│  │  ├─ env.ts                     Zod-validated process.env, fail-fast at boot
│  │  ├─ logger.ts                  Centralized pino-based logger
│  │  ├─ errors.ts                  AppError hierarchy
│  │  ├─ cache.ts                   Cache interface (in-memory default, Redis when REDIS_URL is set)
│  │  ├─ rate-limit.ts              RateLimiter interface + withRateLimit() route wrapper
│  │  ├─ constants.ts               Role enum, ROUTES, roleSatisfies()
│  │  ├─ schemas/                   Zod schemas shared by client forms and API validation
│  │  └─ types/                     ApiResponse<T>, SessionUser, OrganizationSummary, ...
│  │
│  ├─ database/
│  │  ├─ prisma/schema.prisma       User/Session/Account/Verification (Better Auth) + Organization/
│  │  │                             Membership/Workspace (product) models
│  │  ├─ prisma/seed.ts             Dev-only demo data
│  │  ├─ prisma/migrations/         SQL migrations (generated offline via `prisma migrate diff`)
│  │  └─ src/
│  │     ├─ client.ts               Singleton PrismaClient (hot-reload safe)
│  │     ├─ queries/organizations.ts  createOrganizationWithWorkspace, getOrganizationsForUser, ...
│  │     └─ generated/              Prisma Client output (gitignored)
│  │
│  ├─ auth/src/
│  │  ├─ server.ts                  betterAuth() instance (Prisma adapter, email/password, sessions)
│  │  ├─ client.ts                  createAuthClient() for Client Components
│  │  ├─ session.ts                 getServerSession / requireAuth / requireRole
│  │  └─ email.ts                   EmailProvider (console in dev, SMTP when configured)
│  │
│  └─ ui/src/
│     ├─ components/                Button, Input, Textarea, Label, Separator, Badge, Card, Table,
│     │                             Skeleton, Spinner, Avatar, Modal, Dropdown, Form, Toast,
│     │                             ThemeToggle — one file each
│     ├─ lib/utils.ts               cn() — clsx + tailwind-merge
│     └─ index.ts                   Barrel export
│
├─ docs/                            This documentation set
├─ prisma/                          (intentionally absent — lives inside packages/database instead)
├─ docker-compose.yml               Local Postgres + Redis (+ optional full app stack)
├─ Dockerfile                       Multi-stage production build (Next.js standalone output)
├─ turbo.json / pnpm-workspace.yaml / package.json    Monorepo/build orchestration
└─ .env.example
```

## Why this shape

- **Feature-first, not type-first.** Route groups (`(auth)`, `(dashboard)`) and their nested folders
  keep everything a feature needs — page, layout, local components, server actions — together, instead
  of scattering `LoginPage`, `login-form`, and `login validation` across three unrelated top-level
  directories.
- **Packages own a concern, not a layer.** `@bond-os/auth` isn't "backend code that happens to relate
  to auth" — it's the *entire* auth concern (server config, client hooks, session helpers, email),
  reusable by any future app in this monorepo without depending on `apps/web` at all.
- **No `utils.ts` grab-bag.** `apps/web/lib/*` each have a single, named responsibility (API error
  handling, CSRF, storage, active-org resolution) rather than one catch-all utilities file.
