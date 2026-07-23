import type { ApiKeyType, Prisma } from '../generated';
import { prisma } from '../client';

/**
 * Phase 11 — API key persistence. Keys authenticate the public API (`/api/v1`).
 * The plaintext secret is never stored: only its SHA-256 hash (`hashedKey`,
 * unique) and a short display `prefix`. A key is scoped to exactly one
 * organization; PERSONAL keys additionally carry the issuing `userId`. All
 * authorization (scope + org membership) is enforced above this layer.
 */

export interface CreateApiKeyData {
  organizationId: string;
  userId?: string | null;
  type: ApiKeyType;
  name: string;
  prefix: string;
  hashedKey: string;
  scopes: string[];
  expiresAt?: Date | null;
  createdById?: string | null;
}

/** Row shape returned to the auth resolver — never includes the secret. */
export interface ApiKeyRecord {
  id: string;
  organizationId: string;
  userId: string | null;
  type: ApiKeyType;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdById: string | null;
  createdAt: Date;
}

const RECORD_SELECT = {
  id: true,
  organizationId: true,
  userId: true,
  type: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdById: true,
  createdAt: true,
} satisfies Prisma.ApiKeySelect;

export async function createApiKey(data: CreateApiKeyData): Promise<ApiKeyRecord> {
  return prisma.apiKey.create({
    data: {
      organizationId: data.organizationId,
      userId: data.userId ?? null,
      type: data.type,
      name: data.name,
      prefix: data.prefix,
      hashedKey: data.hashedKey,
      scopes: data.scopes,
      expiresAt: data.expiresAt ?? null,
      createdById: data.createdById ?? null,
    },
    select: RECORD_SELECT,
  });
}

/**
 * Resolve a presented key by its hash. Returns the full authorization context
 * (org, optional user, scopes, expiry, revocation) or null when unknown. The
 * caller is responsible for rejecting revoked/expired keys.
 */
export async function findApiKeyByHash(hashedKey: string): Promise<ApiKeyRecord | null> {
  return prisma.apiKey.findUnique({ where: { hashedKey }, select: RECORD_SELECT });
}

export async function getApiKeyById(id: string): Promise<ApiKeyRecord | null> {
  return prisma.apiKey.findUnique({ where: { id }, select: RECORD_SELECT });
}

/**
 * Keys visible to a caller: every ORGANIZATION key in the active org, plus the
 * caller's own PERSONAL keys in that org. Ordered newest-first. Revoked keys
 * are included (the UI greys them out) unless `includeRevoked` is false.
 */
export async function listApiKeys(params: {
  organizationId: string;
  userId: string;
  includeRevoked?: boolean;
}): Promise<ApiKeyRecord[]> {
  const where: Prisma.ApiKeyWhereInput = {
    organizationId: params.organizationId,
    OR: [{ type: 'ORGANIZATION' }, { type: 'PERSONAL', userId: params.userId }],
    ...(params.includeRevoked === false ? { revokedAt: null } : {}),
  };
  return prisma.apiKey.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    select: RECORD_SELECT,
  });
}

/** Best-effort last-used stamp; failures here must never block a request. */
export async function touchApiKey(id: string): Promise<void> {
  await prisma.apiKey.update({ where: { id }, data: { lastUsedAt: new Date() } });
}

/** Idempotent revoke. Returns the updated record, or null if it was not found. */
export async function revokeApiKey(id: string): Promise<ApiKeyRecord | null> {
  const existing = await prisma.apiKey.findUnique({ where: { id }, select: { id: true, revokedAt: true } });
  if (!existing) return null;
  return prisma.apiKey.update({
    where: { id },
    data: { revokedAt: existing.revokedAt ?? new Date() },
    select: RECORD_SELECT,
  });
}

/**
 * Rotate a key's secret in place: same id/name/scopes/type, new hash+prefix.
 * Returns the refreshed record. The old secret stops working immediately.
 */
export async function rotateApiKeyHash(
  id: string,
  next: { prefix: string; hashedKey: string },
): Promise<ApiKeyRecord> {
  return prisma.apiKey.update({
    where: { id },
    data: { prefix: next.prefix, hashedKey: next.hashedKey, revokedAt: null, lastUsedAt: null },
    select: RECORD_SELECT,
  });
}
