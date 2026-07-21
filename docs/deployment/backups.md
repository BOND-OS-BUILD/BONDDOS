# Backups

## Scope

What actually exists in this repository for backing up BOND OS's data — stated precisely: nothing
automated. This document names the two stores that hold durable state, what Docker's own volume
persistence does and does not protect against, and the manual commands an operator has to run
themselves today. Consistent with this documentation set's convention, nothing below is aspirational —
where an automated mechanism doesn't exist, that's stated plainly rather than assumed.

## What needs backing up

Two durable stores, both declared in `docker-compose.yml`:

| Store | Volume | What it holds |
| --- | --- | --- |
| PostgreSQL | `bondos-postgres-data:/var/lib/postgresql/data` | Every relational row across all 67 models — organizations, memberships, the entire knowledge graph, conversations, workflow definitions and runs, approval history, embeddings (pgvector), everything. This is BOND OS's one source of truth. |
| Redis | `bondos-redis-data:/data` | Optional, non-authoritative. When `REDIS_URL` is set, Redis backs `RedisCache` (`packages/shared/src/cache.ts`) — cached reads and per-channel realtime snapshots, all reconstructable from Postgres. Nothing durable is stored here that doesn't also exist in Postgres; losing this volume loses cache warmth, not data. |

Everything else the application touches — uploaded files (avatars, organization logos, comment
attachments) — lives in Supabase Storage when `SUPABASE_URL`/`SUPABASE_KEY` are configured, an
external managed service whose own backup story is outside this repository entirely (see
[Local Development](./local.md#optional-integrations-and-their-local-fallbacks)). This document
covers only what's backed by state inside the Docker Compose stack.

## What Docker volume persistence does and does not protect against

`docker-compose.yml`'s two named volumes (`bondos-postgres-data`, `bondos-redis-data`) survive the
container lifecycle:

- `docker compose down` (or `docker compose --profile full down`) stops and removes containers but
  **leaves both named volumes intact** — the next `docker compose up` sees the same data.
- `docker compose down -v` **deletes the named volumes along with the containers** — this is a real
  data-loss command for the Postgres volume, not just a container reset.

This is container lifecycle persistence, not a backup. It protects against "I restarted the stack" and
does nothing for:

- Host disk failure or corruption (the volume's data lives on the same disk as everything else on that
  machine).
- Accidental `docker compose down -v` or a manually run `docker volume rm bondos-postgres-data`.
- A bad migration, a destructive query run by mistake, or any other logical corruption that gets
  written to the volume and then persists exactly as well as good data does.
- Point-in-time recovery — there is no way to go back to "the database as it was an hour ago" via the
  volume alone; it only ever reflects current state.

## No automated backup mechanism exists

Confirmed by direct inspection, not inferred:

- No `pg_dump`/`pg_restore` invocation anywhere in this repository (application code, scripts, or
  Compose configuration).
- No scheduled job, cron entry, or GitHub Actions workflow that runs a backup — there is no
  `.github/workflows` directory in this repository at all (see [GitHub](./github.md)), and the only
  scheduled/external-caller endpoint that does exist,
  `POST /api/workflows/schedule/tick`, is the user-facing Workflow Automation tick and has nothing to
  do with database backups.
- No backup-related script in the root `package.json` or any package's `package.json` — the full set
  of `db:*` scripts is `db:generate`, `db:migrate`, `db:migrate:deploy`, `db:seed`, `db:studio`; none
  of them dumps or exports data.
- No file or directory named anything like `backup` anywhere in the repository outside
  `node_modules`/`.git`.

If an operator does nothing beyond what this repository provides, the *only* copy of BOND OS's data is
the live `bondos-postgres-data` volume (or, in a hosted-Postgres deployment, whatever the hosting
provider's own retention policy covers — see below).

## Manual backup: the actual command

Since there's no automation, a real backup today is an operator-run `pg_dump` against whichever
Postgres instance `DATABASE_URL` points at:

```bash
# Against the bundled Compose Postgres service:
docker compose exec postgres pg_dump -U bondos -d bondos -F c -f /tmp/bondos-backup.dump
docker compose cp postgres:/tmp/bondos-backup.dump ./bondos-backup-$(date +%Y%m%d).dump

# Against any DATABASE_URL directly (bundled or hosted), from a machine with the postgres client tools:
pg_dump "$DATABASE_URL" -F c -f bondos-backup-$(date +%Y%m%d).dump
```

`-F c` (custom format) is used deliberately over a plain SQL dump — it's compressed and restorable
with `pg_restore`, including selective table restore, without needing to hand-edit a SQL file. Restore:

```bash
pg_restore -d "$DATABASE_URL" --clean --if-exists bondos-backup-20260721.dump
```

`--clean --if-exists` drops existing objects before recreating them, so a restore onto a database that
already has the schema applied doesn't collide with `CREATE TABLE` conflicts. Neither of these commands
is wired into any script in this repository — they are the standard PostgreSQL tool invocations an
operator runs themselves, documented here because nothing else in this codebase performs this step for
them.

## Hosted Postgres: the backup story shifts to the provider

If `DATABASE_URL` points at a managed instance (Supabase, Neon, RDS, or similar — all explicitly
supported connection targets per [Local Development](./local.md#3-database) and
[Production](./production.md)) rather than the bundled Compose `postgres` service, that provider's own
backup/point-in-time-recovery features become the real backup mechanism, entirely outside this
repository's code. This document cannot describe those, since they vary by provider and are configured
in that provider's own console, not in anything BOND OS ships. The one thing that stays true regardless
of provider: BOND OS's own code initiates no backup of any kind, automated or otherwise — whatever
recovery capability exists is either the provider's or the operator's own `pg_dump` habit.

## What's not handled for you

Stated plainly, matching [Production](./production.md#whats-not-handled-for-you)'s own framing:

- **No scheduled backups.** Nothing runs `pg_dump` on any cadence.
- **No off-site/off-volume copy by default.** A manually-run `pg_dump` produces a file wherever the
  operator puts it; nothing uploads it to object storage or a separate host automatically.
- **No backup verification or restore testing.** There is no process in this repository that confirms
  a backup file is restorable.
- **No retention policy.** Nothing prunes old backup files — an operator following the manual command
  above is also responsible for deciding how many dumps to keep and for how long.
- **No embeddings-specific backup consideration.** pgvector `embeddings` rows are ordinary table data
  and are included in a standard `pg_dump` — no special handling is needed, but also none exists to
  make that dump smaller or faster for a large `embeddings` table specifically.

## Related documents

- [Production](./production.md) — the pre-deploy checklist backups are named as a gap in.
- [Docker](./docker.md) — the two named volumes and the `full` profile's service topology.
- [Environment Variables](./environment.md) — `DATABASE_URL` and `REDIS_URL`.
- [Monitoring](./monitoring.md) — the parallel "nothing automated" story for observability.
