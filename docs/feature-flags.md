# Feature Flags

A centralized flag system (Phase 10) with three scopes and runtime toggling.

## Scopes & precedence

Flags evaluate with precedence **USER > ORGANIZATION > GLOBAL**, then the registered default:

```
user override → org override → global override → registry default → false
```

`FeatureFlag` rows are keyed `(key, scope, scopeId)`. GLOBAL rows use an empty-string `scopeId` (never null) so upsert behaves uniformly across scopes.

## Registry

Known flags are declared in `packages/shared/src/feature-flags.ts` (`FEATURE_FLAGS`, `FEATURE_FLAG_DEFINITIONS`) so the app and Admin Console share one source of truth. The table also accepts **arbitrary keys** for ad-hoc kill-switches created at runtime.

## Evaluating

```ts
import { isFeatureEnabled, evaluateAllFlags } from '@/features/feature-flags/services/feature-flag.service';

await isFeatureEnabled('ai.streaming', { organizationId, userId });
await evaluateAllFlags({ organizationId, userId }); // { [key]: boolean }
```

Evaluation reads the database directly (a cheap indexed lookup), so a change in the Admin Console takes effect on the **next request** — true runtime enable/disable.

Clients can read their resolved flags from `GET /api/feature-flags`.

## Managing (platform admin)

UI: `/admin/feature-flags`. API:

- `POST /api/admin/feature-flags` — `{ key, scope, scopeId?, enabled, description? }` (upsert)
- `DELETE /api/admin/feature-flags` — `{ key, scope, scopeId? }`
- `GET /api/admin/feature-flags` — definitions + all override rows

`scopeId` is required for ORGANIZATION (organizationId) and USER (userId) scopes; omit for GLOBAL.
