const MAX_DOMAIN_LENGTH = 253
const DOMAIN_LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const NON_HOST_ASCII = /[^a-z0-9.\-\u0080-\uffff]/

function toAsciiHost(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname || null
  } catch {
    return null
  }
}

export function normalizeCompanyDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
  if (!host) return null
  const domain = (toAsciiHost(host) ?? host).replace(/\.+$/, '').replace(/^www\./, '')
  return domain || null
}

export function parseCompanyDomainFilter(value: string): string | null {
  const input = value.trim().toLowerCase().replace(/^@/, '')
  if (!input || input.length > MAX_DOMAIN_LENGTH || NON_HOST_ASCII.test(input)) return null
  const host = toAsciiHost(input)?.replace(/\.$/, '').replace(/^www\./, '')
  if (!host || host.length > MAX_DOMAIN_LENGTH) return null
  const labels = host.split('.')
  if (labels.length < 2 || !labels.every((label) => DOMAIN_LABEL.test(label))) return null
  if (/^\d+$/.test(labels[labels.length - 1])) return null
  return host
}
