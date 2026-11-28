const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/

const MAX_DOMAINS_PER_CONFIG = 20

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase()
}

export interface DomainValidationResult {
  valid: boolean
  error?: string
  errorKey?: string
}

export function validateDomain(domain: string): DomainValidationResult {
  const normalized = normalizeDomain(domain)

  if (!normalized) return { valid: false, error: 'Domain cannot be empty', errorKey: 'sso.errors.domain.empty' }
  if (normalized.length > 253) return { valid: false, error: 'Domain exceeds maximum length of 253 characters', errorKey: 'sso.errors.domain.tooLong' }
  if (!DOMAIN_REGEX.test(normalized)) return { valid: false, error: 'Invalid domain format — only DNS hostnames are accepted', errorKey: 'sso.errors.domain.invalidFormat' }
  if (!normalized.includes('.')) return { valid: false, error: 'Domain must include at least one dot (e.g., example.com)', errorKey: 'sso.errors.domain.missingDot' }

  return { valid: true }
}

export function uniqueDomains(domains: string[]): string[] {
  return [...new Set(domains.map(normalizeDomain).filter(Boolean))]
}

export function checkDomainLimit(currentCount: number, adding: number): { ok: boolean; error?: string } {
  if (currentCount + adding > MAX_DOMAINS_PER_CONFIG) {
    return { ok: false, error: `Maximum ${MAX_DOMAINS_PER_CONFIG} domains per SSO configuration` }
  }
  return { ok: true }
}

export { MAX_DOMAINS_PER_CONFIG }
