import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { CustomerEntity } from '../data/entities'

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
 * Max person rows scanned by the in-memory fallback match. `primary_email` is
 * GDPR-encrypted with a random IV (see `customers/encryption.ts`), so it cannot
 * be filtered by value in SQL when tenant data encryption is on — recent rows are
 * decrypted and compared in memory instead. Bounded to keep the inbound path cheap;
 * a `primary_email` blind-index (hash) column is the follow-up if tenants outgrow it.
 */
const MATCH_CANDIDATE_LIMIT = 500

/**
 * Batch lookup of CustomerEntity rows (kind='person') whose `primaryEmail`
 * matches any of the given addresses (case-insensitive), scoped to the tenant
 * and organization. Returns at most one MatchedPerson per resolved person.
 *
 * `primary_email` is encrypted with a non-deterministic IV, so a `WHERE
 * primary_email = ?` filter silently matches nothing when encryption is on. We
 * therefore try a direct equality match first (the fast path when encryption is
 * off) and, for any address it leaves unresolved, fall back to scanning recent
 * decrypted person rows and comparing in memory — the same dual-mode pattern as
 * `inbox-actions.ts`.
 */
export async function findPeopleByAddresses(
  em: EntityManager,
  addresses: string[],
  tenantId: string,
  organizationId: string | null = null,
): Promise<MatchedPerson[]> {
  const normalized = normalizeAddresses(addresses)
  if (normalized.length === 0) return []
  if (!organizationId) return []
  const dscope = { tenantId, organizationId }
  const resolved = new Map<string, string>()

  // Fast path: direct equality match. Matches exactly when tenant data encryption
  // is off; returns nothing against encrypted (random-IV) ciphertext, which the
  // in-memory fallback below covers.
  const direct = (await findWithDecryption(
    em,
    CustomerEntity,
    { primaryEmail: { $in: normalized }, kind: 'person', tenantId, organizationId, deletedAt: null },
    undefined,
    dscope,
  )) as Array<{ id: string; primaryEmail?: string | null }>
  for (const row of direct) {
    const rowEmail = row.primaryEmail?.trim().toLowerCase()
    if (rowEmail && !resolved.has(rowEmail)) resolved.set(rowEmail, row.id)
  }

  // Fallback for unresolved addresses (the encryption-on path): scan recent person
  // rows and compare decrypted emails in memory.
  if (normalized.some((email) => !resolved.has(email))) {
    const candidates = (await findWithDecryption(
      em,
      CustomerEntity,
      { kind: 'person', tenantId, organizationId, deletedAt: null },
      { limit: MATCH_CANDIDATE_LIMIT, orderBy: { createdAt: 'DESC' } },
      dscope,
    )) as Array<{ id: string; primaryEmail?: string | null }>
    for (const row of candidates) {
      const rowEmail = row.primaryEmail?.trim().toLowerCase()
      if (rowEmail && !resolved.has(rowEmail)) resolved.set(rowEmail, row.id)
    }
  }

  const seen = new Set<string>()
  const out: MatchedPerson[] = []
  for (const email of normalized) {
    const id = resolved.get(email)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push({ id, email })
  }
  return out
}
