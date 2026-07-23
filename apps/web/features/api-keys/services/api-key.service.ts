import { requireAuth, requireRole } from '@bond-os/auth';
import {
  createApiKey,
  getApiKeyById,
  listApiKeys,
  revokeApiKey,
  rotateApiKeyHash,
  type ApiKeyRecord,
} from '@bond-os/database';
import {
  areScopesValid,
  ForbiddenError,
  NotFoundError,
  ROLES,
  ValidationError,
  type CreateApiKeyInput,
} from '@bond-os/shared';

import { getActiveOrganization } from '@/lib/organization';

import { generateApiKey } from '../lib/key';

/**
 * Phase 11 — API key management (session-authenticated, org-scoped).
 *
 * Authorization model:
 *   • ORGANIZATION keys act for the whole org → only ADMIN+ may create, rotate,
 *     or revoke them.
 *   • PERSONAL keys act as an individual member → any member may create their
 *     own, and only the owner (or an ADMIN) may rotate/revoke them.
 * Every operation is bound to the caller's active organization, so a key can
 * never be created for or mutated in an org the caller isn't a member of.
 */

/** Public view of a key — the secret is never part of this shape. */
export interface ApiKeyView {
  id: string;
  name: string;
  type: ApiKeyRecord['type'];
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  isOwn: boolean;
}

function toView(record: ApiKeyRecord, callerUserId: string): ApiKeyView {
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    prefix: record.prefix,
    scopes: record.scopes,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    isOwn: record.userId === callerUserId,
  };
}

async function resolveCaller(): Promise<{ userId: string; organizationId: string }> {
  const session = await requireAuth();
  const { active } = await getActiveOrganization(session.user.id);
  if (!active) {
    throw new ForbiddenError('Create or join an organization before managing API keys.');
  }
  return { userId: session.user.id, organizationId: active.id };
}

export async function listApiKeysService(): Promise<ApiKeyView[]> {
  const { userId, organizationId } = await resolveCaller();
  const records = await listApiKeys({ organizationId, userId });
  return records.map((record) => toView(record, userId));
}

export interface CreatedApiKeyResult {
  key: ApiKeyView;
  /** The one-time plaintext secret. Surfaced to the client exactly once. */
  plaintext: string;
}

export async function createApiKeyService(input: CreateApiKeyInput): Promise<CreatedApiKeyResult> {
  const { userId, organizationId } = await resolveCaller();

  if (!areScopesValid(input.scopes)) {
    throw new ValidationError('One or more requested scopes are not recognized.');
  }
  // Organization-wide keys are a privileged, org-level credential.
  if (input.type === 'ORGANIZATION') {
    await requireRole(organizationId, ROLES.ADMIN);
  }

  const secret = generateApiKey();
  const expiresAt =
    input.expiresInDays === undefined
      ? null
      : new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000);

  const record = await createApiKey({
    organizationId,
    userId: input.type === 'PERSONAL' ? userId : null,
    type: input.type,
    name: input.name,
    prefix: secret.prefix,
    hashedKey: secret.hashedKey,
    scopes: input.scopes,
    expiresAt,
    createdById: userId,
  });

  return { key: toView(record, userId), plaintext: secret.plaintext };
}

/** Load a key, asserting it belongs to the caller's org and they may mutate it. */
async function loadManageable(
  id: string,
  caller: { userId: string; organizationId: string },
): Promise<ApiKeyRecord> {
  const record = await getApiKeyById(id);
  if (!record || record.organizationId !== caller.organizationId) {
    // Do not leak existence of keys in other orgs.
    throw new NotFoundError('API key not found.');
  }
  if (record.type === 'ORGANIZATION') {
    await requireRole(caller.organizationId, ROLES.ADMIN);
  } else if (record.userId !== caller.userId) {
    // Someone else's personal key — admins may still revoke it.
    await requireRole(caller.organizationId, ROLES.ADMIN);
  }
  return record;
}

export async function revokeApiKeyService(id: string): Promise<ApiKeyView> {
  const caller = await resolveCaller();
  await loadManageable(id, caller);
  const revoked = await revokeApiKey(id);
  if (!revoked) throw new NotFoundError('API key not found.');
  return toView(revoked, caller.userId);
}

export async function rotateApiKeyService(id: string): Promise<CreatedApiKeyResult> {
  const caller = await resolveCaller();
  const existing = await loadManageable(id, caller);
  if (existing.revokedAt) {
    throw new ValidationError('This key has been revoked and cannot be rotated. Create a new key instead.');
  }
  const secret = generateApiKey();
  const record = await rotateApiKeyHash(id, { prefix: secret.prefix, hashedKey: secret.hashedKey });
  return { key: toView(record, caller.userId), plaintext: secret.plaintext };
}
