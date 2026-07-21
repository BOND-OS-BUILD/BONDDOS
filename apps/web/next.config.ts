import type { NextConfig } from 'next';

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
    '/**': ['../../packages/database/src/generated/**/*'],
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
