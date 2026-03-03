import { slugifyTagLabel } from '@open-mercato/shared/lib/utils'

export function generateTempId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `tmp-${Math.random().toString(36).slice(2)}`
}

export function isValidSocialUrl(
  rawValue: string,
  options: { hosts: string[]; pathRequired?: boolean },
): boolean {
  const { hosts, pathRequired = false } = options
  let parsed: URL
  try {
    parsed = new URL(rawValue)
  } catch {
    return false
  }
  const protocol = parsed.protocol.toLowerCase()
  if (protocol !== 'https:' && protocol !== 'http:') {
    return false
  }
  const hostname = parsed.hostname.toLowerCase()
  const matchesHost = hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`))
  if (!matchesHost) {
    return false
  }
  if (!pathRequired) {
    return true
  }
  const normalizedPath = parsed.pathname.replace(/\/+/g, '/').replace(/^\/|\/$/g, '')
  return normalizedPath.length > 0
}

export { slugifyTagLabel }
