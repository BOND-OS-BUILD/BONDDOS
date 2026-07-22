import type { Prisma, UserStatus } from '../generated';
import { prisma } from '../client';

/**
 * Phase 10 — platform-level (cross-organization) user queries backing the
 * Admin Console's Users view and the platform-admin authorization gate.
 * Ordinary org-scoped user access still goes through membership queries; this
 * repository is only for platform administrators operating the whole
 * deployment. Enforce `requirePlatformAdmin()` at the service layer before
 * calling anything here.
 */

/** Whether the user holds the platform-admin DB flag. */
export async function isUserPlatformAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPlatformAdmin: true },
  });
  return user?.isPlatformAdmin ?? false;
}

/** Grant or revoke the platform-admin flag. */
export async function setUserPlatformAdmin(userId: string, isPlatformAdmin: boolean): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { isPlatformAdmin } });
}

export interface PlatformUserListItem {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  isPlatformAdmin: boolean;
  organizationCount: number;
  createdAt: Date;
  lastActiveAt: Date | null;
}

export interface ListPlatformUsersParams {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface PlatformUserPage {
  items: PlatformUserListItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** Paginated, searchable list of every user in the deployment. */
export async function listPlatformUsers(params: ListPlatformUsersParams = {}): Promise<PlatformUserPage> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const where: Prisma.UserWhereInput = params.search
    ? {
        OR: [
          { email: { contains: params.search, mode: 'insensitive' } },
          { name: { contains: params.search, mode: 'insensitive' } },
        ],
      }
    : {};

  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        isPlatformAdmin: true,
        createdAt: true,
        _count: { select: { memberships: true } },
        sessions: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      status: row.status,
      isPlatformAdmin: row.isPlatformAdmin,
      organizationCount: row._count.memberships,
      createdAt: row.createdAt,
      lastActiveAt: row.sessions[0]?.createdAt ?? null,
    })),
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export interface PlatformUserStats {
  total: number;
  active: number;
  platformAdmins: number;
  newLast30Days: number;
}

/** Deployment-wide user counts for the Admin Console overview. */
export async function getPlatformUserStats(): Promise<PlatformUserStats> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [total, active, platformAdmins, newLast30Days] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { status: 'ACTIVE' } }),
    prisma.user.count({ where: { isPlatformAdmin: true } }),
    prisma.user.count({ where: { createdAt: { gte: since } } }),
  ]);
  return { total, active, platformAdmins, newLast30Days };
}
