import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
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
 * Batch lookup of CustomerEntity rows (kind='person') whose `primaryEmail`
 * matches any of the given addresses (case-insensitive), scoped to the tenant
 * and organization.
 *
 * Why one query per address: `primary_email` is encrypted, so SQL `WHERE
 * primary_email IN (...)` against ciphertext can't match. Each call to
 * `findOneWithDecryption` uses the canonical deterministic-encryption lookup
 * (matching `inbox-actions.ts`'s lookup pattern). N is typically 1-5 per
 * inbound email (From + To + Cc), so the cost is acceptable.
 *
 * If a future optimization is needed, integrate with `search_tokens` (see
 * `customers/api/utils.ts:findSearchTokenEntityIds`).
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
  const seen = new Set<string>()
  const out: MatchedPerson[] = []
  for (const email of normalized) {
    const row = (await findOneWithDecryption(
      em,
      CustomerEntity,
      {
        primaryEmail: email,
        kind: 'person',
        tenantId,
        organizationId,
        deletedAt: null,
      } as any,
      undefined,
      dscope,
    )) as { id: string; primaryEmail?: string | null } | null
    if (!row) continue
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push({ id: row.id, email })
  }
  return out
}
