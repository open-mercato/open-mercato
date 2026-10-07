export function normalizeCompanyDomain(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d+$/, '')
    .replace(/\.+$/, '')
    .replace(/^www\./, '')
  return host.length > 0 ? host : null
}

export function parseCompanyDomainFilter(value: string): string | null {
  const domain = value.trim().toLowerCase().replace(/^@/, '').replace(/^www\./, '')
  const interiorDot = domain.indexOf('.', 1)
  if (/[\s/:]/.test(domain) || interiorDot < 0 || interiorDot === domain.length - 1) return null
  return normalizeCompanyDomain(domain)
}
