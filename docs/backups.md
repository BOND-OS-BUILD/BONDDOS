# Backups & Recovery

Phase 10 prepares backup **infrastructure and procedures**. Automatic scheduled backups are intentionally **not** implemented — they are an operator/provider responsibility.

## What to back up

| Asset | Method | Automatable by |
| --- | --- | --- |
| Database (Postgres) | `pg_dump` / provider snapshots | your Postgres provider |
| Object storage | Supabase Storage copy / S3 sync | your storage provider |
| Configuration | `GET /api/admin/backup/config` (JSON) | in-app export |

## Database export

```bash
pg_dump "$DATABASE_URL" --no-owner --no-privileges -Fc -f bond-os-$(date +%F).dump
```

Restore into an empty database:

```bash
pg_restore --no-owner --no-privileges -d "$TARGET_DATABASE_URL" bond-os-YYYY-MM-DD.dump
```

Managed providers (e.g. Supabase) also offer point-in-time recovery and daily snapshots — prefer those for production; treat `pg_dump` as a portable, provider-independent supplement. The schema requires the `vector` (pgvector) extension in the target.

## Storage export

The app uses a single public bucket (`bondos-public`, folders: avatars, logos, documents, knowledge, comments). Export with the Supabase CLI or any S3-compatible tool against the bucket. Storage objects are referenced by path from DB rows, so restore storage **and** database together to keep references valid.

## Configuration export

```bash
curl -s https://<app>/api/admin/backup/config -H "Cookie: <admin session>" > config.json
```

Returns feature flags + rate-limit policies. Re-apply into another environment via the Admin Console (`POST /api/admin/feature-flags`, `POST /api/admin/rate-limits`) or a small script.

## Recovery procedure

1. Provision a Postgres with `pgvector`; set `DATABASE_URL`.
2. `pg_restore` the latest dump (or promote the provider snapshot).
3. Restore storage objects into `bondos-public`.
4. Re-apply configuration export.
5. Set the required secrets (`BETTER_AUTH_SECRET`, `APP_URL`, `NEXT_PUBLIC_APP_URL`) — see [production.md](production.md).
6. Deploy; verify `/api/health/ready` returns `200` and sign-in works.

## Retention

Application observability tables are pruned on a retention schedule (see [operations.md](operations.md)); those rows are not part of a functional restore and can be excluded from long-term backups if desired.
