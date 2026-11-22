import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '../data/entities'
import { findBlindIndexMatches, MATCH_CANDIDATE_LIMIT, normalizedPlaintextFilter } from './findBlindIndexMatches'

export { MATCH_CANDIDATE_LIMIT }

/**
 * Lower-cases, trims, and dedupes a list of email-shaped strings.
 * Rejects anything that doesn't look like `x@y` (single `@`, not at the start
 * or end, no consecutive `@`).
 */
export function normalizeAddresses(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim().toLowerCase()
    if (!trimmed) continue
    const at = trimmed.indexOf('@')
    if (at <= 0 || at === trimmed.length - 1 || trimmed.lastIndexOf('@') !== at) continue
    if (seen.has(trimmed)) continue
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

export interface MatchedPerson {
  /** customer_entities.id (the anchor for customer_interactions.entity_id). */
  id: string
  /** Lowercased email address. */
  email: string
}

/**
 * Resolves scoped person emails through the blind index, then plaintext equality
 * and a bounded scan of recent records during backfill.
 */
export async function findPeopleByAddresses(
  em: EntityManager,
  addresses: string[],
  tenantId: string,
  organizationId: string | null = null,
): Promise<MatchedPerson[]> {
  const values = normalizeAddresses(addresses)
  if (!organizationId || values.length === 0) return []

  const scope = { tenantId, organizationId }
  const where = { ...scope, kind: 'person' as const, deletedAt: null }
  const rows = await findBlindIndexMatches(
    em,
    scope,
    { entityId: 'customers:customer_entity', column: 'primary_email' },
    values,
    {
      byHash: (hashes) => findWithDecryption(
        em, CustomerEntity, { ...where, primaryEmailHash: { $in: hashes } }, undefined, scope,
      ),
      byPlaintext: (emails) => findWithDecryption(
        em, CustomerEntity, { ...where, ...normalizedPlaintextFilter('primary_email', emails) }, undefined, scope,
      ),
      recent: () => findWithDecryption(em, CustomerEntity, where, {
        limit: MATCH_CANDIDATE_LIMIT,
        orderBy: { createdAt: 'DESC' },
      }, scope),
      id: (row) => row.id,
      value: (row) => row.primaryEmail,
      normalize: (email) => email.trim().toLowerCase(),
    },
  )
  return rows.map(({ id, value }) => ({ id, email: value }))
}
