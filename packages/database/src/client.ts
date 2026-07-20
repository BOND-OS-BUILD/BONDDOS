import { PrismaClient } from './generated/index.js';

/**
 * Singleton PrismaClient. Next.js hot-reloads server modules in dev, which
 * would otherwise exhaust the Postgres connection pool by constructing a new
 * PrismaClient (and new connections) on every edit — so we cache the
 * instance on `globalThis` outside of production.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
