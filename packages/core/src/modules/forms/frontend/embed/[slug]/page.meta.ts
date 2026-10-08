import type { PageMetadata } from '@open-mercato/shared/modules/registry'

/**
 * External iframe host page for an embeddable OPEN distribution (spec
 * `2026-05-21-forms-render-surfaces.md`, S4 / D4–D6). Unauthenticated by design
 * — the slug is the bearer of access, and the anonymous public runtime enforces
 * availability / cap / CAPTCHA exactly as `/f/:slug`.
 *
 * SECURITY (R-RS-1) — HOST PLUMBING NOT WIRED IN THIS REPO.
 *
 * The design calls for this route to be served with a per-distribution
 * `Content-Security-Policy: frame-ancestors <allowedDomains>` header and no
 * `X-Frame-Options`, with the app's global frame protection carving `/embed/`
 * out so the dynamic header is the sole authority, resolved via
 * `GET /api/forms/public/distributions/:slug/embed-policy`
 * (→ `buildFrameAncestorsCsp` in `lib/embed-frame-policy.ts`).
 *
 * Neither half exists yet. `apps/mercato/next.config.ts` applies
 * `frame-ancestors 'self'` plus `X-Frame-Options: SAMEORIGIN` to `/:path*` with
 * no `/embed/` carve-out, and `apps/mercato/src/proxy.ts` never calls the
 * embed-policy endpoint. It was absent from the module's original repository
 * too — that sandbox app declared no `headers()` at all, so `/embed/:slug` was
 * framable there by default rather than by policy.
 *
 * Consequence: cross-origin framing of this page is currently BLOCKED by the
 * app's global policy. That is the fail-closed direction, so the page is safe
 * and the embed surface is inert. Everything below the header is complete and
 * tested — availability / cap / CAPTCHA enforcement, theme application, the
 * allowlist normalizer, the `embed-policy` endpoint. Only the header is missing.
 *
 * Both halves are load-bearing: a carve-out without the dynamic header would
 * leave this page framable by anyone. A per-request response header cannot come
 * from a React Server Component, so it belongs in the proxy. Tracked in
 * `.ai/specs/2026-09-30-forms-module-into-core.md` § Known limitations.
 */
export const metadata: PageMetadata = {
  requireAuth: false,
  titleKey: 'forms.runner.loading',
  title: 'Form',
}

export default metadata
