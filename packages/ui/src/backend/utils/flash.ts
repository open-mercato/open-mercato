export type FlashType = 'success' | 'error' | 'warning' | 'info'

// Append flash message and type to a URL (relative or absolute) and return a relative URL string.
export function withFlash(url: string, message: string, type: FlashType = 'success'): string {
  const base = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost'
  const u = new URL(url, base)
  u.searchParams.set('flash', message)
  u.searchParams.set('type', type)
  const qs = u.searchParams.toString()
  return `${u.pathname}${qs ? `?${qs}` : ''}`
}

// Helper to push a URL with flash via Next.js router
export function pushWithFlash(router: { push: (href: string) => any }, url: string, message: string, type: FlashType = 'success') {
  router.push(withFlash(url, message, type))
}

