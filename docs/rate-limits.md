# Rate Limiting

Phase 10 expands the existing limiter (`packages/shared/src/rate-limit.ts`, unchanged pluggable backend) with **configurable, scope-aware policies**.

## Scopes

`USER`, `ORGANIZATION`, `API`, `AI`, `TOOL`, `WORKFLOW`.

## Resolution order

For a `(scope, identifier)` the effective limit resolves as:

```
policy row (scope, identifier) → default policy row (scope, "") →
per-scope code default → env RATE_LIMIT_DEFAULT_LIMIT / _WINDOW_SECONDS
```

Per-scope code defaults (req / window): USER 300/60s, ORGANIZATION 1000/60s, API 120/60s, AI 30/60s, TOOL 60/60s, WORKFLOW 60/60s.

## Enforcing

```ts
import { enforceRateLimit } from '@/features/rate-limits/services/rate-limit.service';

await enforceRateLimit({ scope: 'AI', identifier: organizationId, request, organizationId, userId });
```

On breach it records a `RATE_LIMIT_EXCEEDED` security event and throws `RateLimitError` → `429` via `apiHandler`. `RateLimitPolicy` rows are configurable at runtime; a disabled policy skips enforcement.

## Managing (platform admin)

UI: `/admin/rate-limits`. API:

- `GET /api/admin/rate-limits`
- `POST /api/admin/rate-limits` — `{ scope, key?, limit, windowSeconds, enabled?, description? }` (blank `key` = the scope default)
- `DELETE /api/admin/rate-limits` — `{ scope, key? }`

## Backend note

The shipped limiter is in-memory (per-instance) — correct for single-instance and low-traffic multi-instance deploys. For strict cross-instance enforcement, swap in a Redis-backed `RateLimiter` at `getRateLimiter()` (the call sites don't change). This mirrors the limiter's own long-standing doc note.
