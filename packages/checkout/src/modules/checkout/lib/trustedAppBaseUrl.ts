export function resolveTrustedAppBaseUrl(): string | null {
  const configuredUrl = process.env.APP_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!configuredUrl) {
    return process.env.NODE_ENV === 'production' ? null : 'http://localhost:3000'
  }

  try {
    const url = new URL(configuredUrl)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      return null
    }
    return url.origin + url.pathname.replace(/\/+$/, '')
  } catch {
    return null
  }
}
