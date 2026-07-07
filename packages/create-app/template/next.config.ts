import type { NextConfig } from "next";
import { resolveAllowedDevOrigins } from './src/lib/dev-origins'

const isDevelopment = process.env.NODE_ENV !== 'production'
const allowedDevOrigins = isDevelopment ? resolveAllowedDevOrigins() : []

const nextConfig: NextConfig = {
  distDir: '.mercato/next',
  experimental: {
    serverMinification: false,
    turbopackMinify: false,
    // Mirror apps/mercato: treat these barrel-heavy packages as having
    // modularized exports so only the named exports actually used are
    // evaluated. Keeps scaffolded apps on the same client-bundle baseline.
    //   - lucide-react: icons used across the default backend components.
    //   - recharts: pairs with the next/dynamic chart split in @open-mercato/ui.
    //   - date-fns: already deep-imported; listed here as defense-in-depth.
    optimizePackageImports: ['lucide-react', 'recharts', 'date-fns'],
    ...(isDevelopment
      ? {
          preloadEntriesOnStart: false,
          // Cap Turbopack's in-memory cache so long dev sessions trigger
          // eviction instead of unbounded RSS growth. The template pins
          // Next 16.2.x where the byte-count knob is the supported API;
          // on Next >=16.3 replace with `turbopackMemoryEviction: 'full'`.
          turbopackMemoryLimit: 4 * 1024 * 1024 * 1024,
        }
      : {}),
  },
  allowedDevOrigins: allowedDevOrigins.length > 0 ? allowedDevOrigins : undefined,
  // Transpile @open-mercato packages that have TypeScript in src/
  // Note: @open-mercato/shared is excluded as it has pre-built dist/ files
  transpilePackages: [
    '@open-mercato/core',
    '@open-mercato/ui',
    '@open-mercato/events',
    '@open-mercato/cache',
    '@open-mercato/queue',
    '@open-mercato/search',
    '@open-mercato/content',
    '@open-mercato/onboarding',
    '@open-mercato/ai-assistant',
  ],
  serverExternalPackages: [
    'esbuild',
    '@esbuild/darwin-arm64',
    '@open-mercato/cli',
  ],
  // Mirror server-only env vars that client components must observe. Keep this
  // list minimal — anything added here is inlined into the client bundle.
  env: {
    OM_SEARCH_MIN_LEN: process.env.OM_SEARCH_MIN_LEN,
  },
}

export default nextConfig
