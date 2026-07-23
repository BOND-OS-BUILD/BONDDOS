# API Keys (Phase 11)

## Scope

API keys authenticate the public API (`/api/v1`) and GraphQL. A key is scoped to
one organization and carries a set of scopes.

- `packages/database/src/repositories/api-keys.ts` — persistence.
- `apps/web/features/api-keys/lib/key.ts` — key generation/hashing.
- `apps/web/features/api-keys/services/api-key.service.ts` — management.
- `apps/web/features/api-keys/auth/api-auth.ts` — the public-API auth resolver.
- Settings → API keys — the UI.

## Key material

A key is `bond_sk_<64 hex chars>`. Only its **SHA-256 hash** (`hashedKey`,
unique) and a short display `prefix` are stored — the plaintext is shown to the
user exactly once, at creation or rotation. Lookups are by hash
(`findApiKeyByHash`).

## Personal vs organization keys

- **PERSONAL** — acts as the issuing member; any member may create their own.
  Required for endpoints that read a user's own data (e.g. notifications).
- **ORGANIZATION** — acts org-wide; only **ADMIN** may create, rotate, or
  revoke them.

The settings list shows every org key plus the caller's personal keys. A
personal key can be managed by its owner or an admin; an org key by any admin.

## Scopes

Scopes are defined in `packages/shared/src/api-scopes.ts` (`API_SCOPES`) — e.g.
`projects:read`, `tasks:read`, `custom-objects:write`, `webhooks:manage`. A key
grants a subset; `scopeSatisfies` checks a required scope against the grant
(with `*` as a super-scope). Requested scopes are validated against the catalog
at creation (`areScopesValid`).

## Lifecycle

| Operation | Route |
| --- | --- |
| Create | `POST /api/api-keys` (returns the plaintext once) |
| List | `GET /api/api-keys` |
| Revoke | `DELETE /api/api-keys/{id}` (idempotent) |
| Rotate | `POST /api/api-keys/{id}/rotate` (new secret, old one stops working) |

Keys may carry an optional `expiresInDays`; the auth resolver rejects revoked or
expired keys with `401`, and records a best-effort `lastUsedAt` on each use.

## Request authentication

The resolver (`resolveApiKeyContext`) extracts the bearer token, validates its
shape, looks it up by hash, rejects revoked/expired keys, stamps the request
context (org/user) for logging, and returns `{ keyId, organizationId, userId,
scopes }`. `apiV1Handler` wraps this with per-key rate limiting and per-route
scope enforcement — see `docs/public-api.md`.
