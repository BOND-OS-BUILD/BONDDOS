import type { Prisma } from '../generated';
import { prisma } from '../client';

/**
 * Phase 10 — platform-wide (cross-organization) read models for the Admin
 * Console. Call only behind `requirePlatformAdmin()` in the service layer.
 * These deliberately read the existing operational tables (organizations,
 * users, sessions, workflow runs, tool executions, audit events) — no
 * duplicated storage.
 */

export interface PlatformPage<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

function paginate(params: { page?: number; pageSize?: number }): { page: number; pageSize: number; skip: number; take: number } {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export interface PlatformStats {
  organizations: number;
  users: number;
  platformAdmins: number;
  activeSessions: number;
  workflowRuns: number;
  toolExecutions: number;
  conversations: number;
  aiRequests24h: number;
}

export async function getPlatformStats(): Promise<PlatformStats> {
  const now = new Date();
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [organizations, users, platformAdmins, activeSessions, workflowRuns, toolExecutions, conversations, aiRequests24h] =
    await Promise.all([
      prisma.organization.count(),
      prisma.user.count(),
      prisma.user.count({ where: { isPlatformAdmin: true } }),
      prisma.session.count({ where: { expiresAt: { gt: now } } }),
      prisma.workflowRun.count(),
      prisma.toolExecution.count(),
      prisma.conversation.count(),
      prisma.aiAuditLog.count({ where: { createdAt: { gte: dayAgo } } }),
    ]);
  return { organizations, users, platformAdmins, activeSessions, workflowRuns, toolExecutions, conversations, aiRequests24h };
}

export interface PlatformOrgListItem {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  createdAt: Date;
}

export async function listPlatformOrganizations(
  params: { page?: number; pageSize?: number; search?: string } = {},
): Promise<PlatformPage<PlatformOrgListItem>> {
  const { page, pageSize, skip, take } = paginate(params);
  const where: Prisma.OrganizationWhereInput = params.search
    ? {
        OR: [
          { name: { contains: params.search, mode: 'insensitive' } },
          { slug: { contains: params.search, mode: 'insensitive' } },
        ],
      }
    : {};
  const [rows, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: { id: true, name: true, slug: true, createdAt: true, _count: { select: { memberships: true } } },
    }),
    prisma.organization.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      memberCount: row._count.memberships,
      createdAt: row.createdAt,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface PlatformSessionListItem {
  id: string;
  userEmail: string;
  userName: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
}

export async function listPlatformSessions(
  params: { page?: number; pageSize?: number } = {},
): Promise<PlatformPage<PlatformSessionListItem>> {
  const { page, pageSize, skip, take } = paginate(params);
  const where: Prisma.SessionWhereInput = { expiresAt: { gt: new Date() } };
  const [rows, total] = await Promise.all([
    prisma.session.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
        user: { select: { email: true, name: true } },
      },
    }),
    prisma.session.count({ where }),
  ]);
  return {
    items: rows.map((row) => ({
      id: row.id,
      userEmail: row.user.email,
      userName: row.user.name,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface PlatformWorkflowRunListItem {
  id: string;
  organizationId: string;
  status: string;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export async function listPlatformWorkflowRuns(
  params: { page?: number; pageSize?: number } = {},
): Promise<PlatformPage<PlatformWorkflowRunListItem>> {
  const { page, pageSize, skip, take } = paginate(params);
  const [rows, total] = await Promise.all([
    prisma.workflowRun.findMany({
      orderBy: { startedAt: 'desc' },
      skip,
      take,
      select: { id: true, organizationId: true, status: true, error: true, startedAt: true, completedAt: true },
    }),
    prisma.workflowRun.count(),
  ]);
  return { items: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface PlatformToolExecutionListItem {
  id: string;
  organizationId: string;
  status: string;
  duration: number | null;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

export async function listPlatformToolExecutions(
  params: { page?: number; pageSize?: number } = {},
): Promise<PlatformPage<PlatformToolExecutionListItem>> {
  const { page, pageSize, skip, take } = paginate(params);
  const [rows, total] = await Promise.all([
    prisma.toolExecution.findMany({
      orderBy: { startedAt: 'desc' },
      skip,
      take,
      select: { id: true, organizationId: true, status: true, duration: true, error: true, startedAt: true, completedAt: true },
    }),
    prisma.toolExecution.count(),
  ]);
  return { items: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface PlatformAuditEventListItem {
  id: string;
  organizationId: string;
  userId: string | null;
  action: string;
  createdAt: Date;
}

export async function listPlatformAuditEvents(
  params: { page?: number; pageSize?: number } = {},
): Promise<PlatformPage<PlatformAuditEventListItem>> {
  const { page, pageSize, skip, take } = paginate(params);
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: { id: true, organizationId: true, userId: true, action: true, createdAt: true },
    }),
    prisma.auditEvent.count(),
  ]);
  return { items: rows, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export interface PlatformAiUsage {
  totalTokens: number;
  assistantMessages: number;
  requests: number;
}

export async function getPlatformAiUsage(since: Date): Promise<PlatformAiUsage> {
  const [tokenRows, requests] = await Promise.all([
    prisma.$queryRaw<Array<{ total: bigint | null; messages: bigint | null }>>`
      SELECT
        COALESCE(SUM(
          COALESCE((("tokenUsage"->>'promptTokens'))::bigint, 0) +
          COALESCE((("tokenUsage"->>'completionTokens'))::bigint, 0)
        ), 0) AS total,
        COUNT(*) AS messages
      FROM "messages"
      WHERE "role" = 'ASSISTANT' AND "createdAt" >= ${since} AND "tokenUsage" IS NOT NULL
    `,
    prisma.aiAuditLog.count({ where: { createdAt: { gte: since } } }),
  ]);
  return {
    totalTokens: Number(tokenRows[0]?.total ?? 0n),
    assistantMessages: Number(tokenRows[0]?.messages ?? 0n),
    requests,
  };
}
