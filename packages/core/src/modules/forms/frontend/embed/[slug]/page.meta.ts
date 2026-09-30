import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * External iframe host page for an embeddable OPEN distribution (spec
 * `2026-05-21-forms-render-surfaces.md`, S4 / D4–D6). Unauthenticated by design
 * — the slug is the bearer of access, and the anonymous public runtime enforces
 * availability / cap / CAPTCHA exactly as `/f/:slug`.
 *
 * SECURITY (R-RS-1): this route is served with a per-distribution
 * `Content-Security-Policy: frame-ancestors <allowedDomains>` header and no
 * `X-Frame-Options`. The app's global frame protection in
 * `apps/mercato/next.config.ts` EXCLUDES `/embed/`; the dynamic header is
 * applied by `apps/mercato/src/proxy.ts`, which resolves the allowlist via
 * `GET /api/forms/public/distributions/:slug/embed-policy`
 * (→ `buildFrameAncestorsCsp` in `lib/embed-frame-policy.ts`). Fails closed
 * (`frame-ancestors 'none'`) for non-embeddable / unknown slugs.
 */
export const metadata: PageMetadata = {
  requireAuth: false,
  titleKey: 'forms.runner.loading',
  title: 'Form',
}

export default metadata
