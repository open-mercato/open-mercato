import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerCompanyProfile } from '../data/entities'
import { findBlindIndexMatches, MATCH_CANDIDATE_LIMIT, normalizedPlaintextFilter } from './findBlindIndexMatches'

function normalizeDomain(input: string): string | null {
  const value = input.trim().toLowerCase().replace(/^@/, '').replace(/^www\./, '')
  return /[\s@/:]/.test(value) || !value.slice(1, -1).includes('.') ? null : value
}

export function normalizeDomains(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  for (const item of input) {
    if (typeof item !== 'string') continue
    const domain = normalizeDomain(item)
    if (domain !== null) seen.add(domain)
  }
  return Array.from(seen)
}

export interface MatchedCompany {
  /** The owning customer_entities.id. */
  id: string
  /** The normalized domain. */
  domain: string
}

export async function findCompaniesByDomains(
  em: EntityManager,
  domains: string[],
  tenantId: string,
  organizationId: string | null = null,
): Promise<MatchedCompany[]> {
  const values = normalizeDomains(domains)
  if (!organizationId || values.length === 0) return []

  const scope = { tenantId, organizationId }
  const where = { ...scope, entity: { ...scope, kind: 'company' as const, deletedAt: null } }
  const rows = await findBlindIndexMatches(
    em,
    scope,
    { entityId: 'customers:customer_company_profile', column: 'domain' },
    values,
    {
      byHash: (hashes) => findWithDecryption(
        em, CustomerCompanyProfile, { ...where, domainHash: { $in: hashes } }, undefined, scope,
      ),
      byPlaintext: (domains) => findWithDecryption(
        em, CustomerCompanyProfile, { ...where, ...normalizedPlaintextFilter('domain', domains) }, undefined, scope,
      ),
      recent: () => findWithDecryption(em, CustomerCompanyProfile, where, {
        limit: MATCH_CANDIDATE_LIMIT,
        orderBy: { createdAt: 'DESC' },
      }, scope),
      id: (row) => row.entity.id,
      value: (row) => row.domain,
      normalize: normalizeDomain,
      variants: (domain) => [domain, `www.${domain}`, `@${domain}`, `@www.${domain}`],
    },
  )
  return rows.map(({ id, value }) => ({ id, domain: value }))
}
