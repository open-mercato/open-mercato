const SENTINEL_ORIGIN = 'https://notifications.open-mercato.local'
const CONTROL_OR_BACKSLASH = /[\u0000-\u001F\u007F\\]/

export function isSafeNotificationHref(href: string): boolean {
  if (!href.startsWith('/') || href.startsWith('//')) {
    return false
  }

  if (CONTROL_OR_BACKSLASH.test(href)) {
    return false
  }

  try {
    const parsed = new URL(href, SENTINEL_ORIGIN)
    return parsed.origin === SENTINEL_ORIGIN && !parsed.pathname.startsWith('//')
  } catch {
    return false
  }
}
