/**
 * Navigable-URL policy.
 *
 * Forms lets a designer configure two post-submission redirect targets — a
 * distribution's `redirect_url` and an ending section's `x-om-redirect-url` —
 * and both end up assigned to `window.location` by a runner. On the anonymous
 * `/f/:slug` and `/embed/:slug` surfaces that runner executes in the app's own
 * origin, under a CSP that allows `'unsafe-inline'`, so a target the browser is
 * willing to treat as script is stored XSS against every respondent.
 *
 * `z.string().url()` does NOT prevent that. Zod's URL check only asks whether
 * `new URL(value)` parses, and `javascript:alert(1)`, `data:text/html,…` and
 * `vbscript:…` all parse. Verified against the repo's installed zod:
 *
 *   z.string().url().max(2000).safeParse('javascript:alert(1)')  → success
 *
 * So the scheme has to be checked explicitly. This mirrors
 * `normalizeEmbedOrigin` in `embed-frame-policy.ts` — same fail-closed shape,
 * same http/https-only rule — but allows a path, query and fragment, which a
 * redirect target needs and an allowlisted frame-ancestor origin must not have.
 */

const NAVIGABLE_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:'])

/**
 * Canonical form of a URL that is safe to hand to `window.location`, or `null`
 * when it is not one.
 *
 * Rejects every scheme except `http:` and `https:` — notably `javascript:`,
 * `data:`, `vbscript:`, `blob:` and `file:` — plus embedded credentials, which
 * browsers render inconsistently and which are a phishing vector in a redirect
 * a respondent never typed. Scheme comparison is on `URL.protocol`, which is
 * already lowercased, so `JaVaScRiPt:` cannot slip past on case.
 */
export function normalizeNavigableUrl(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null
  const trimmed = candidate.trim()
  if (!trimmed) return null

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }

  if (!NAVIGABLE_PROTOCOLS.has(url.protocol)) return null
  if (url.username || url.password) return null
  if (!url.hostname) return null

  return url.toString()
}

/** True when `candidate` is safe to assign to `window.location`. */
export function isNavigableUrl(candidate: unknown): boolean {
  return normalizeNavigableUrl(candidate) !== null
}
