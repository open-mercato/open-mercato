import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

const isDevelopment = process.env.NODE_ENV !== 'production'
const appPackageJsonPath = new URL('./package.json', import.meta.url)
const appPackageJson = JSON.parse(fs.readFileSync(appPackageJsonPath, 'utf8')) as {
  dependencies?: Record<string, string>
}
const transpiledWorkspacePackages = Object.keys(appPackageJson.dependencies ?? {}).filter(
  (packageName) => packageName.startsWith('@open-mercato/') && packageName !== '@open-mercato/cli',
)

const nextConfig: NextConfig = {
  distDir: '.mercato/next',
  transpilePackages: isDevelopment ? transpiledWorkspacePackages : undefined,
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
