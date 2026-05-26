export function sanitizeRedirectPath(
  rawRedirect: string | null | undefined,
  baseUrl: string,
  fallback: string,
): string {
  if (!rawRedirect) return fallback
  try {
    const base = new URL(baseUrl)
    const resolved = new URL(rawRedirect, baseUrl)
    if (resolved.origin !== base.origin) return fallback
    if (!resolved.pathname.startsWith('/')) return fallback
    // Reject path traversal / open-redirect bypass vectors that contain `//`
    // anywhere in the resolved pathname (e.g. `/backend//evil.com`,
    // `//evil.com`, or backslash sequences that the URL parser normalizes
    // to `//`). The fragment/query may legitimately contain `//`, so only
    // the pathname is checked.
    if (resolved.pathname.includes('//')) return fallback
    return resolved.pathname + resolved.search + resolved.hash
  } catch {
    return fallback
  }
}
