# BOND OS

The AI-native operating system for startups.

This repository currently contains **Phase 0: Core Platform Foundation** — the production-grade
infrastructure (authentication, organizations, workspaces, users, settings, database, API skeleton,
UI kit) that every future BOND OS module (Knowledge Graph, Company Memory, AI Brain, Search, Agents,
Automations) will be built on top of. **This phase contains zero AI logic** — infrastructure only.

## Stack

| Layer          | Choice                                                    |
| -------------- | ----------------------------------------------------------- |
| Frontend       | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS |
| UI components  | Hand-authored shadcn/ui-style kit (Radix UI + cva)          |
| Backend        | Next.js Route Handlers                                      |
| Database       | PostgreSQL + Prisma ORM                                     |
| Auth           | Better Auth (email/password, sessions)                      |
| Storage        | Supabase Storage                                             |
| Caching        | Redis (interface-only; in-memory by default)                 |
| Validation     | Zod                                                          |
| Client state   | Zustand                                                      |
| Monorepo       | pnpm workspaces + Turborepo                                  |
| Deployment     | Docker (multi-stage), Vercel-compatible                      |

See [`docs/Architecture.md`](docs/Architecture.md) for the reasoning behind these choices,
[`docs/FolderStructure.md`](docs/FolderStructure.md) for a tour of the codebase, and
[`docs/Setup.md`](docs/Setup.md) to get a local environment running end to end.

## Quick start

```bash
corepack pnpm install
cp .env.example .env          # then fill in DATABASE_URL at minimum
docker compose up -d postgres # or point DATABASE_URL at any Postgres instance
corepack pnpm db:migrate
corepack pnpm dev
```

Visit `http://localhost:3000`, sign up, and the first organization you create becomes your workspace.
Full walkthrough (including optional Redis/Supabase/SMTP setup) in [`docs/Setup.md`](docs/Setup.md).

## Monorepo layout

```
apps/
  web/               Next.js application (pages, API routes, dashboard shell)
packages/
  config/            Shared TypeScript / ESLint / Tailwind presets
  shared/            Env validation, logging, errors, cache, rate-limit, zod schemas, shared types
  database/          Prisma schema, generated client, seed script
  auth/               Better Auth server/client config, session + authorization helpers
  ui/                Reusable component library (Button, Input, Card, Modal, Table, ...)
docs/                Architecture, folder structure, and setup documentation
```

## Common scripts

Run from the repo root (Turborepo fans these out to the right workspace):

| Script                | What it does                                              |
| ---------------------- | ----------------------------------------------------------- |
| `pnpm dev`             | Start the Next.js dev server                                |
| `pnpm build`           | Build every package/app                                     |
| `pnpm lint`             | Lint every package/app                                      |
| `pnpm typecheck`       | Type-check every package/app                                |
| `pnpm format`          | Format the repo with Prettier                                |
| `pnpm db:migrate`      | Apply Prisma migrations (dev)                                |
| `pnpm db:migrate:deploy` | Apply Prisma migrations (production, non-interactive)     |
| `pnpm db:seed`         | Seed demo data (an organization + workspace)                 |
| `pnpm db:studio`       | Open Prisma Studio                                            |

## What's intentionally not here yet

Per the Phase 0 scope, there is deliberately no AI logic, Knowledge Graph, Memory, Search, Chat,
Agents, Automation, Connectors, Analytics, Notifications, Projects/Tasks, or CRM functionality. Those
sidebar sections exist as placeholders (`packages/ui` + `apps/web`'s dashboard shell) so future phases
have somewhere to attach without touching this foundation.
