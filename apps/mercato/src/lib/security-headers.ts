/**
 * Shared HTTP security headers for the app. Centralized so the global
 * `next.config.ts` header rule and the per-route `/embed` proxy build an
 * IDENTICAL Content-Security-Policy and differ ONLY in the `frame-ancestors`
 * directive. The global rule keeps `frame-ancestors 'self'`; the embed
 * proxy injects a per-distribution allowlist (forms render-surfaces spec
 * `2026-05-21-forms-render-surfaces.md`, S4 / D6 / R-RS-1).
 */

/** Default frame protection: only same-origin may frame the app. */
export const DEFAULT_FRAME_ANCESTORS = "frame-ancestors 'self'"

/**
 * Builds the app Content-Security-Policy. `frameAncestors` is a complete CSP
 * directive string (e.g. `"frame-ancestors 'self'"` or
 * `"frame-ancestors https://acme.com"`), letting the embed proxy inject a
 * per-distribution allowlist while every other route keeps the default.
 */
export function buildContentSecurityPolicy(frameAncestors: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "font-src 'self' data: https:",
    "form-action 'self'",
    frameAncestors,
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "img-src 'self' data: blob: https:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self' https: ws: wss:",
  ].join('; ')
}

/** Non-framing security headers shared by the global config and the embed route. */
export const baseSecurityHeaders: ReadonlyArray<{ key: string; value: string }> = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
]
