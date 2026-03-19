import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: '.mercato/next',
  experimental: {
    serverMinification: false,
    turbopackMinify: false,
  },
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
}

export default nextConfig
