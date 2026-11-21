import type { EntityManager } from '@mikro-orm/postgresql'
import { isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
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
 * Max rows scanned by in-memory fallback matches over encrypted contact
 * columns (`primary_email` here, `primary_phone` in the check-phone route).
 * These columns are GDPR-encrypted with a random IV (see
 * `customers/encryption.ts`), so they cannot be filtered by value in SQL when
 * tenant data encryption is on — fallbacks decrypt recent rows and compare in
 * memory instead. Bounded to keep interactive lookups cheap; a blind-index
 * (hash) column per field is the follow-up if tenants outgrow it (#5515).
 */
export const MATCH_CANDIDATE_LIMIT = 500

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

const INBOUND_EMAIL_CONTACT_PAGE_SIZE = 100

type ContactScope = { tenantId: string; organizationId: string | null }

export function createInboundEmailContactLookup(em: EntityManager) {
  const contactsByScope = new Map<string, Promise<Map<string, string>>>()

  return async (email: string, { tenantId, organizationId }: ContactScope): Promise<string | undefined> => {
    const [address] = normalizeAddresses([email])
    if (!address || !organizationId) return undefined

    const key = JSON.stringify([tenantId, organizationId])
    let contacts = contactsByScope.get(key)
    if (!contacts) {
      contacts = loadInboundEmailContacts(em, { tenantId, organizationId }).catch((error: unknown) => {
        contactsByScope.delete(key)
        throw error
      })
      contactsByScope.set(key, contacts)
    }
    return (await contacts).get(address)
  }
}

async function loadInboundEmailContacts(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
): Promise<Map<string, string>> {
  const contacts = new Map<string, string>()
  let lastPersonId: string | undefined

  while (true) {
    const people = await findWithDecryption(
      em,
      CustomerEntity,
      {
        ...scope,
        kind: 'person',
        deletedAt: null,
        primaryEmail: { $ne: null },
        ...(lastPersonId ? { id: { $gt: lastPersonId } } : {}),
      },
      {
        fields: ['id', 'tenantId', 'organizationId', 'primaryEmail'],
        orderBy: { id: 'ASC' },
        limit: INBOUND_EMAIL_CONTACT_PAGE_SIZE,
        disableIdentityMap: true,
      },
      scope,
    )
    for (const person of people) {
      if (isEncryptedPayloadShape(person.primaryEmail)) {
        throw new Error('[internal] CRM contact email could not be decrypted')
      }
      const [address] = normalizeAddresses([person.primaryEmail])
      if (address && !contacts.has(address)) contacts.set(address, person.id)
    }
    if (people.length < INBOUND_EMAIL_CONTACT_PAGE_SIZE) return contacts
    lastPersonId = people.at(-1)?.id
  }
}
