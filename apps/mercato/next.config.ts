import type { NextConfig } from "next";
import path from "node:path";

const isDevelopment = process.env.NODE_ENV !== 'production'

const nextConfig: NextConfig = {
  distDir: '.mercato/next',
  experimental: {
    serverMinification: false,
    turbopackMinify: false,
    ...(isDevelopment
      ? {
          preloadEntriesOnStart: false,
        }
      : {}),
  },
  turbopack: {
    // Monorepo root is two levels up from apps/mercato
    root: path.resolve(process.cwd(), "../.."),
  },
  // Externalize packages that are only used in CLI context, not Next.js
  serverExternalPackages: [
    'esbuild',
    '@esbuild/darwin-arm64',
    '@open-mercato/cli',
  ],
}

export default nextConfig
