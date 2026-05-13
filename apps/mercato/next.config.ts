import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";
import { resolveAllowedDevOrigins } from './src/lib/dev-origins'

const isDevelopment = process.env.NODE_ENV !== 'production'
const appPackageJsonPath = new URL('./package.json', import.meta.url)
const appPackageJson = JSON.parse(fs.readFileSync(appPackageJsonPath, 'utf8')) as {
  dependencies?: Record<string, string>
}
const transpiledWorkspacePackages = Object.keys(appPackageJson.dependencies ?? {}).filter(
  (packageName) => packageName.startsWith('@open-mercato/') && packageName !== '@open-mercato/cli',
)
const allowedDevOrigins = isDevelopment ? resolveAllowedDevOrigins() : []

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' data: https:",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
  "img-src 'self' data: blob: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self' https: ws: wss:",
].join('; ')

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
    const originHeaderName = (process.env.CUSTOMER_DOMAIN_ORIGIN_HEADER ?? 'X-Open-Mercato-Origin').trim()
    return [
      {
        source: '/:path*',
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
      {
        // Marker header consumed by the custom-domain DNS reverse-resolve check
        // (see SPEC 2026-04-08-portal-custom-domain-routing). Lets the verifier
        // tell "request reached our origin" from "request was answered by an
        // unrelated host that proxied it through Cloudflare/Fastly".
        source: '/_next/health',
        headers: [{ key: originHeaderName, value: '1' }],
      },
    ]
  },
}

export default nextConfig
