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
