import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerCompanyProfile, CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import { decryptCustomFieldValue, resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { XERO_COMPANY_FIELDS_ENTITY_ID, XERO_CONTACT_MARKER_FIELD, XERO_TAX_NUMBER_FIELD } from '../field-definitions'
import type { XeroScope } from '../owner'

export const XERO_INDEX_CHUNK_SIZE = 500

export type XeroIndexCompany = { entityId: string; createdAt: Date; displayName: string | null }
export type XeroIndexValue = { entityId: string; value: string }

export type XeroCompanyIndexSources = {
  companies: XeroIndexCompany[]
  markers: XeroIndexValue[]
  taxNumbers: XeroIndexValue[]
}

export type XeroCompanyIndexes = {
  findMarked(marker: string): string | null
  findByTaxNumber(normalizedTaxNumber: string): string[]
  findByName(name: string): string[]
  markClaimed(entityId: string): void
  recordTaxNumberClaim(normalizedTaxNumber: string, contactId: string): void
  taxNumberClaimedBy(normalizedTaxNumber: string): string | null
  addCompanyName(entityId: string, name: string): void
}

/** App Spec § 6.1: whitespace stripped, uppercase. */
export function normalizeTaxNumber(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, '').toUpperCase()
  return normalized.length > 0 ? normalized : null
}

/** Lowercase, punctuation stripped, whitespace collapsed; serves the duplicate-risk warning only, never a match. */
export function normalizeCompanyName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.toLowerCase().replace(/\p{P}+/gu, '').replace(/\s+/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

function storedText(row: CustomFieldValue): string | null {
  return row.valueText ?? row.valueMultiline ?? null
}

async function loadCompanies(em: EntityManager, scope: XeroScope): Promise<XeroIndexCompany[]> {
  const companies: XeroIndexCompany[] = []
  let afterId: string | null = null
  for (;;) {
    const rows: CustomerEntity[] = await findWithDecryption(
      em.fork({ clear: true }),
      CustomerEntity,
      {
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
        kind: 'company',
        deletedAt: null,
        ...(afterId ? { id: { $gt: afterId } } : {}),
      },
      { orderBy: { id: 'asc' }, limit: XERO_INDEX_CHUNK_SIZE },
      scope,
    )
    for (const row of rows) companies.push({ entityId: row.id, createdAt: row.createdAt, displayName: row.displayName ?? null })
    if (rows.length < XERO_INDEX_CHUNK_SIZE) return companies
    afterId = rows[rows.length - 1].id
  }
}

async function loadProfileEntityIds(em: EntityManager, scope: XeroScope, profileIds: string[]): Promise<Map<string, string>> {
  const entityByProfile = new Map<string, string>()
  for (const ids of chunk(profileIds, XERO_INDEX_CHUNK_SIZE)) {
    const profiles = await findWithDecryption(
      em.fork({ clear: true }),
      CustomerCompanyProfile,
      { id: { $in: ids }, organizationId: scope.organizationId, tenantId: scope.tenantId },
      {},
      scope,
    )
    for (const profile of profiles) entityByProfile.set(profile.id, profile.entity.id)
  }
  return entityByProfile
}

/**
 * Reads what the marker, tax-number and name indexes need: every Company of the organization that
 * is not deleted (chunks of 500, names decrypted), and the organization's `xero_contact_id` and
 * `xero_tax_number` values resolved from their profile to the Company. Each chunk reads through a
 * fresh fork, so only the normalized values stay in memory, never the entities. The tax number is
 * an encrypted field, so its values are decrypted; a value that is not ciphertext comes back as is.
 */
export async function loadXeroCompanyIndexSources(em: EntityManager, scope: XeroScope): Promise<XeroCompanyIndexSources> {
  const companies = await loadCompanies(em, scope)
  const liveCompanyIds = new Set(companies.map((company) => company.entityId))
  const valueRows = await findWithDecryption(
    em.fork({ clear: true }),
    CustomFieldValue,
    {
      entityId: XERO_COMPANY_FIELDS_ENTITY_ID,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      fieldKey: { $in: [XERO_CONTACT_MARKER_FIELD, XERO_TAX_NUMBER_FIELD] },
      deletedAt: null,
    },
    {},
    scope,
  )
  const entityByProfile = await loadProfileEntityIds(em, scope, [...new Set(valueRows.map((row) => row.recordId))])
  const encryptionService = resolveTenantEncryptionService(em)
  const keyCache = new Map<string | null, string | null>()

  const markers: XeroIndexValue[] = []
  const storedTaxNumbers: XeroIndexValue[] = []
  for (const row of valueRows) {
    const entityId = entityByProfile.get(row.recordId)
    const stored = storedText(row)
    if (!entityId || !liveCompanyIds.has(entityId) || stored === null) continue
    if (row.fieldKey === XERO_CONTACT_MARKER_FIELD) markers.push({ entityId, value: stored })
    else storedTaxNumbers.push({ entityId, value: stored })
  }
  const decrypted = await Promise.all(
    storedTaxNumbers.map(async ({ entityId, value }) => ({
      entityId,
      value: await decryptCustomFieldValue(value, scope.tenantId, encryptionService, keyCache, { kind: 'text' }),
    })),
  )
  const taxNumbers = decrypted.flatMap(({ entityId, value }) => (typeof value === 'string' ? [{ entityId, value }] : []))
  return { companies, markers, taxNumbers }
}

function byAge(createdAtById: Map<string, number>) {
  return (left: string, right: string) => {
    const difference = (createdAtById.get(left) ?? 0) - (createdAtById.get(right) ?? 0)
    if (difference !== 0) return difference
    return left < right ? -1 : left > right ? 1 : 0
  }
}

function addToIndex(index: Map<string, string[]>, key: string, entityId: string): void {
  const entries = index.get(key)
  if (!entries) index.set(key, [entityId])
  else if (!entries.includes(entityId)) entries.push(entityId)
}

/**
 * Builds the run's indexes (App Spec § 6.1). The marker and tax indexes answer only Companies
 * without a `sync_xero` mapping, oldest first: `isMapped` is the run index, which grows with every
 * won claim, and `markClaimed` drops a Company the run claimed. The name index answers every
 * Company and feeds only the duplicate-risk warning.
 */
export function buildXeroCompanyIndexes(sources: XeroCompanyIndexSources, isMapped: (entityId: string) => boolean): XeroCompanyIndexes {
  const createdAtById = new Map(sources.companies.map((company) => [company.entityId, company.createdAt.getTime()]))
  const oldestFirst = byAge(createdAtById)
  const claimed = new Set<string>()
  const eligible = (entityId: string) => !claimed.has(entityId) && !isMapped(entityId)

  const markerIndex = new Map<string, string[]>()
  for (const marker of sources.markers) addToIndex(markerIndex, marker.value.trim(), marker.entityId)
  const taxIndex = new Map<string, string[]>()
  for (const taxNumber of sources.taxNumbers) {
    const normalized = normalizeTaxNumber(taxNumber.value)
    if (normalized) addToIndex(taxIndex, normalized, taxNumber.entityId)
  }
  const nameIndex = new Map<string, string[]>()
  for (const company of sources.companies) {
    const normalized = normalizeCompanyName(company.displayName)
    if (normalized) addToIndex(nameIndex, normalized, company.entityId)
  }
  for (const entries of [...markerIndex.values(), ...taxIndex.values(), ...nameIndex.values()]) entries.sort(oldestFirst)
  const taxClaims = new Map<string, string>()

  return {
    findMarked(marker) {
      return (markerIndex.get(marker.trim()) ?? []).find(eligible) ?? null
    },
    findByTaxNumber(normalizedTaxNumber) {
      return (taxIndex.get(normalizedTaxNumber) ?? []).filter(eligible)
    },
    findByName(name) {
      const normalized = normalizeCompanyName(name)
      return normalized ? [...(nameIndex.get(normalized) ?? [])] : []
    },
    markClaimed(entityId) {
      claimed.add(entityId)
    },
    recordTaxNumberClaim(normalizedTaxNumber, contactId) {
      if (!taxClaims.has(normalizedTaxNumber)) taxClaims.set(normalizedTaxNumber, contactId)
    },
    taxNumberClaimedBy(normalizedTaxNumber) {
      return taxClaims.get(normalizedTaxNumber) ?? null
    },
    addCompanyName(entityId, name) {
      const normalized = normalizeCompanyName(name)
      if (normalized) addToIndex(nameIndex, normalized, entityId)
    },
  }
}

/** Builds the indexes once, on the first unmapped Contact of a run; a run whose Contacts are all mapped never loads them. */
export function createLazyXeroCompanyIndexes(
  load: () => Promise<XeroCompanyIndexSources>,
  isMapped: (entityId: string) => boolean,
): () => Promise<XeroCompanyIndexes> {
  let built: Promise<XeroCompanyIndexes> | null = null
  return () => {
    if (!built) {
      built = load()
        .then((sources) => buildXeroCompanyIndexes(sources, isMapped))
        .catch((error: unknown) => {
          built = null
          throw error
        })
    }
    return built
  }
}
