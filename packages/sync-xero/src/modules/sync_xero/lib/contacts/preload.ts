import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerAddress, CustomerCompanyProfile, CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { XERO_ADDRESS_MAPPING_TYPE, XERO_COMPANY_MAPPING_TYPE, XERO_INTEGRATION_ID } from '../constants'
import { XERO_COMPANY_FIELDS_ENTITY_ID } from '../field-definitions'
import type { XeroScope } from '../owner'
import type { AddressSnapshot } from './addresses'
import type { CompanySnapshot } from './compare'

const CUSTOM_FIELD_PREFIX = 'cf_'

/** The organization's `sync_xero` Company mappings, read once per run and grown by every won claim. */
export type XeroRunIndex = {
  lookup(externalId: string): string | null
  isMapped(entityId: string): boolean
  add(externalId: string, entityId: string): void
}

export async function loadXeroRunIndex(em: EntityManager, scope: XeroScope): Promise<XeroRunIndex> {
  const rows = await findWithDecryption(
    em,
    SyncExternalIdMapping,
    {
      integrationId: XERO_INTEGRATION_ID,
      internalEntityType: XERO_COMPANY_MAPPING_TYPE,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    {},
    scope,
  )
  const byExternalId = new Map(rows.map((row) => [row.externalId, row.internalEntityId]))
  const mapped = new Set(rows.map((row) => row.internalEntityId))
  return {
    lookup: (externalId) => byExternalId.get(externalId) ?? null,
    isMapped: (entityId) => mapped.has(entityId),
    add(externalId, entityId) {
      byExternalId.set(externalId, entityId)
      mapped.add(entityId)
    },
  }
}

/**
 * Loads the Companies a page needs in a fixed number of queries, whatever the page size: the
 * Companies (not deleted, decrypted), their profiles and the profiles' custom-field values. A
 * Company missing from the result is deleted in OM or outside the organization.
 */
export async function loadCompanySnapshots(em: EntityManager, scope: XeroScope, entityIds: string[]): Promise<Map<string, CompanySnapshot>> {
  const snapshots = new Map<string, CompanySnapshot>()
  const ids = [...new Set(entityIds)]
  if (ids.length === 0) return snapshots
  const companies = await findWithDecryption(
    em,
    CustomerEntity,
    { id: { $in: ids }, organizationId: scope.organizationId, tenantId: scope.tenantId, kind: 'company', deletedAt: null },
    {},
    scope,
  )
  if (companies.length === 0) return snapshots
  const profiles = await findWithDecryption(
    em,
    CustomerCompanyProfile,
    { entity: { $in: companies.map((company) => company.id) }, organizationId: scope.organizationId, tenantId: scope.tenantId },
    {},
    scope,
  )
  const profileByEntity = new Map(profiles.map((profile) => [profile.entity.id, profile]))
  const profileIds = profiles.map((profile) => profile.id)
  const customByProfile = await loadCustomFieldValues({
    em,
    entityId: XERO_COMPANY_FIELDS_ENTITY_ID,
    recordIds: profileIds,
    tenantIdByRecord: Object.fromEntries(profileIds.map((id) => [id, scope.tenantId])),
    organizationIdByRecord: Object.fromEntries(profileIds.map((id) => [id, scope.organizationId])),
    tenantFallbacks: [scope.tenantId],
  })

  for (const company of companies) {
    const profile = profileByEntity.get(company.id) ?? null
    const custom: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(profile ? customByProfile[profile.id] ?? {} : {})) {
      custom[key.startsWith(CUSTOM_FIELD_PREFIX) ? key.slice(CUSTOM_FIELD_PREFIX.length) : key] = value
    }
    snapshots.set(company.id, {
      entityId: company.id,
      displayName: company.displayName ?? null,
      legalName: profile?.legalName ?? null,
      primaryEmail: company.primaryEmail ?? null,
      primaryPhone: company.primaryPhone ?? null,
      websiteUrl: profile?.websiteUrl ?? null,
      status: company.status ?? null,
      isActive: company.isActive !== false,
      custom,
    })
  }
  return snapshots
}

/** A page's Xero-owned address rows: the `customers.address` mappings of its Contacts and the rows they name. */
export type XeroAddressState = {
  addressIdByExternalId: Map<string, string>
  addresses: Map<string, AddressSnapshot>
}

export function emptyXeroAddressState(): XeroAddressState {
  return { addressIdByExternalId: new Map(), addresses: new Map() }
}

export async function loadXeroAddressState(em: EntityManager, scope: XeroScope, externalIds: string[]): Promise<XeroAddressState> {
  const state = emptyXeroAddressState()
  if (externalIds.length === 0) return state
  const mappings = await findWithDecryption(
    em,
    SyncExternalIdMapping,
    {
      integrationId: XERO_INTEGRATION_ID,
      internalEntityType: XERO_ADDRESS_MAPPING_TYPE,
      externalId: { $in: [...new Set(externalIds)] },
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    },
    {},
    scope,
  )
  if (mappings.length === 0) return state
  for (const mapping of mappings) state.addressIdByExternalId.set(mapping.externalId, mapping.internalEntityId)
  const rows = await findWithDecryption(
    em,
    CustomerAddress,
    { id: { $in: mappings.map((mapping) => mapping.internalEntityId) }, organizationId: scope.organizationId, tenantId: scope.tenantId },
    {},
    scope,
  )
  for (const row of rows) {
    state.addresses.set(row.id, {
      id: row.id,
      entityId: row.entity.id,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2 ?? null,
      city: row.city ?? null,
      region: row.region ?? null,
      postalCode: row.postalCode ?? null,
      country: row.country ?? null,
    })
  }
  return state
}
