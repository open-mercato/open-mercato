import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";
import { resolveAllowedDevOrigins } from './src/lib/dev-origins'
import { buildContentSecurityPolicy, DEFAULT_FRAME_ANCESTORS } from './src/lib/security-headers'

const isDevelopment = process.env.NODE_ENV !== 'production'
const appPackageJsonPath = new URL('./package.json', import.meta.url)
const appPackageJson = JSON.parse(fs.readFileSync(appPackageJsonPath, 'utf8')) as {
  dependencies?: Record<string, string>
}
const transpiledWorkspacePackages = Object.keys(appPackageJson.dependencies ?? {}).filter(
  (packageName) => packageName.startsWith('@open-mercato/') && packageName !== '@open-mercato/cli',
)
const allowedDevOrigins = isDevelopment ? resolveAllowedDevOrigins() : []

// Default app CSP. The `/embed/:slug` forms-embed host page is EXCLUDED from
// this global rule (see the `headers()` source below) and gets a dynamic,
// per-distribution `frame-ancestors` from `src/proxy.ts` instead.
const contentSecurityPolicy = buildContentSecurityPolicy(DEFAULT_FRAME_ANCESTORS)

const nextConfig: NextConfig = {
  distDir: '.mercato/next',
  //transpilePackages: isDevelopment ? transpiledWorkspacePackages : undefined,
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
  allowedDevOrigins: allowedDevOrigins.length > 0 ? allowedDevOrigins : undefined,
  // Externalize packages that are only used in CLI context, not Next.js
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
  async headers() {
    return [
      {
        // Excludes `/embed/*` — the forms external-embed host page needs a
        // dynamic per-distribution `frame-ancestors` and NO `X-Frame-Options`,
        // both applied by `src/proxy.ts`. Every other route keeps the
        // default same-origin frame protection.
        source: '/((?!embed/).*)',
        headers: [
          { key: 'Content-Security-Policy', value: contentSecurityPolicy },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        // Attachment file downloads set their own restrictive CSP (sandbox)
        // in the route handler — override the global app CSP so it is not
        // replaced at the Next.js config layer.
        source: '/api/attachments/file/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ]
  },
}

export default nextConfig
