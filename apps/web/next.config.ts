import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';

// ── Prisma query-engine bundling fix (Vercel serverless) ──────────────────
// @bond-os/database generates its Prisma Client — including the native
// query-engine binary (libquery_engine-rhel-openssl-3.0.x.so.node) — to a
// custom path, packages/database/src/generated. On Vercel the client is
// bundled into apps/web/.next/server/chunks and, at runtime, searches for its
// engine relative to the app dir: /var/task/apps/web/src/generated,
// /var/task/apps/web/.next/server, etc. It does NOT search
// /var/task/packages/database/src/generated, which is the only place plain
// file-tracing leaves the engine — so the first real DB query throws
// PrismaClientInitializationError ("could not locate the Query Engine for
// runtime rhel-openssl-3.0.x"). (Confirmed in production runtime logs; it
// only surfaces on an actual query, which is why a green build never caught
// it.) Fix: at build time (next.config is evaluated before the build/trace),
// copy the generated client into apps/web/src/generated — one of the paths
// Prisma actually searches — and force-include it in every function's trace
// via outputFileTracingIncludes below.
const prismaEngineSrc = join(process.cwd(), '..', '..', 'packages', 'database', 'src', 'generated');
const prismaEngineDest = join(process.cwd(), 'src', 'generated');
// Copy ONLY the native engine binaries (*.so.node) — not the generated .js
// client, which would otherwise be linted by `next build` and fail on its
// require()-style imports. The engine binary is all Prisma needs to find at
// one of its runtime search paths.
if (existsSync(prismaEngineSrc)) {
  mkdirSync(prismaEngineDest, { recursive: true });
  for (const file of readdirSync(prismaEngineSrc)) {
    if (file.endsWith('.so.node')) {
      copyFileSync(join(prismaEngineSrc, file), join(prismaEngineDest, file));
    }
  }
}

const nextConfig: NextConfig = {
  // Standalone output is for the Docker image (see Dockerfile) — it traces
  // and symlinks only the dependencies actually used at runtime into
  // .next/standalone. On native Windows (outside Docker/WSL) this requires
  // symlink privileges (Developer Mode or an elevated shell) — see
  // docs/Setup.md's Windows note. Doesn't affect `next dev` or Docker/Linux/
  // Vercel builds.
  output: 'standalone',
  transpilePackages: [
    '@bond-os/ui',
    '@bond-os/shared',
    '@bond-os/auth',
    '@bond-os/database',
    '@bond-os/parsers',
    '@bond-os/connectors',
    '@bond-os/extraction',
    '@bond-os/embeddings',
    '@bond-os/ai',
  ],
  // pino/thread-stream spawn a worker thread by resolving a `lib/worker.js`
  // path relative to their own package at runtime — webpack can't trace
  // that dynamic path, so bundling it breaks worker resolution. Leaving
  // these as real `require()`s (untouched in node_modules) fixes it.
  // pdf-parse/mammoth are Node-oriented parsing libraries with dynamic
  // requires of their own — externalized proactively for the same reason,
  // rather than rediscovering the same class of build failure again.
  serverExternalPackages: ['pino', 'pino-pretty', 'pdf-parse', 'mammoth'],
  // @bond-os/database generates its Prisma Client to a custom path outside
  // apps/web (packages/database/src/generated), not the default
  // node_modules/.prisma/client Next's file-tracing looks for automatically.
  // The generated query-engine binary is loaded dynamically at runtime (not
  // a statically-analyzable require), so it isn't picked up by default
  // tracing either — without this, a deployed serverless function throws
  // "Query engine library ... could not be found" the first time it queries
  // the database, even though the build itself succeeds. Applies to every
  // route since almost every route touches the database.
  outputFileTracingIncludes: {
    // 'src/generated/**/*' is the copy made above, landing at
    // /var/task/apps/web/src/generated (a path Prisma searches). The second
    // entry keeps the original monorepo-relative copy as a belt-and-suspenders
    // fallback.
    '/**': ['src/generated/**/*', '../../packages/database/src/generated/**/*'],
  },
  eslint: {
    ignoreDuringBuilds: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
      },
    ],
  },
};

export default nextConfig;
