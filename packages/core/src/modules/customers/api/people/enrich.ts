import type { EntityManager } from '@mikro-orm/postgresql'
import { CustomerPersonProfile } from '../../data/entities'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'

export type CustomerPersonListItem = Record<string, unknown>

type CustomFieldFilter = {
  recordKey: string
  values: string[]
  mode: 'any' | 'eq'
}

function normalizeCustomFieldFilters(query: Record<string, unknown>): CustomFieldFilter[] {
  return Object.entries(query)
    .filter(([key, value]) => key.startsWith('cf_') && value !== undefined && value !== null && value !== '')
    .map(([rawKey, rawValue]) => {
      const isIn = rawKey.endsWith('In')
      const key = isIn ? rawKey.slice(3, -2) : rawKey.slice(3)
      const recordKey = `cf_${key}`
      const normalizedRaw = Array.isArray(rawValue)
        ? rawValue.map((value) => String(value)).join(',')
        : String(rawValue)
      const values = (isIn ? normalizedRaw.split(',') : [normalizedRaw])
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
      return values.length ? { recordKey, values, mode: isIn ? 'any' : 'eq' } : null
    })
    .filter((entry): entry is CustomFieldFilter => entry !== null)
}

function recordMatchesFilters(
  entityId: string,
  filters: CustomFieldFilter[],
  profileByEntityId: Map<string, CustomerPersonProfile>,
  cfValues: Record<string, Record<string, unknown>>
): boolean {
  if (!filters.length) return true
  const profile = profileByEntityId.get(entityId)
  if (!profile) return false
  const cf = cfValues?.[profile.id] ?? {}
  return filters.every((filter) => {
    const value = cf?.[filter.recordKey]
    if (value === undefined || value === null) return false
    const storedValues = Array.isArray(value) ? value : [value]
    const normalizedStored = storedValues
      .map((entry) => {
        if (entry === null || entry === undefined) return ''
        if (typeof entry === 'string') return entry.trim()
        return String(entry).trim()
      })
      .filter((entry) => entry.length > 0)
    if (!normalizedStored.length) return false
    if (filter.mode === 'any') {
      return filter.values.some((candidate) => normalizedStored.includes(candidate))
    }
    const target = filter.values[0] ?? ''
    return normalizedStored.some((stored) => stored === target)
  })
}

function appendCustomFields(
  item: CustomerPersonListItem,
  profileByEntityId: Map<string, CustomerPersonProfile>,
  cfValues: Record<string, Record<string, unknown>>
): CustomerPersonListItem {
  const entityId = typeof item?.id === 'string' ? item.id : null
  if (!entityId) return item
  const profile = profileByEntityId.get(entityId)
  if (!profile) return item
  const cf = cfValues?.[profile.id] ?? {}
  if (!cf || !Object.keys(cf).length) return item
  return { ...item, ...cf }
}

export async function enrichPeopleListWithCustomFields(
  em: EntityManager,
  items: CustomerPersonListItem[],
  query: Record<string, unknown>
): Promise<CustomerPersonListItem[]> {
  if (!Array.isArray(items) || items.length === 0) return items

  const entityIds = items
    .map((item) => (typeof item?.id === 'string' ? item.id : null))
    .filter((id): id is string => !!id)
  if (!entityIds.length) return items

  const profiles: CustomerPersonProfile[] = await em.find(CustomerPersonProfile, { entity: { $in: entityIds } })
  if (!profiles.length) return items

  const profileByEntityId = new Map<string, CustomerPersonProfile>()
  for (const profile of profiles) {
    const entityId = typeof profile.entity === 'string' ? profile.entity : profile.entity?.id
    if (entityId) profileByEntityId.set(entityId, profile)
  }
  if (!profileByEntityId.size) return items

  const recordIds = profiles.map((profile) => profile.id)
  if (!recordIds.length) return items

  const tenantIdByRecord: Record<string, string | null> = {}
  const organizationIdByRecord: Record<string, string | null> = {}
  for (const profile of profiles) {
    tenantIdByRecord[profile.id] = profile.tenantId ?? null
    organizationIdByRecord[profile.id] = profile.organizationId ?? null
  }

  const cfValues = await loadCustomFieldValues({
    em,
    entityId: E.customers.customer_person_profile,
    recordIds,
    tenantIdByRecord,
    organizationIdByRecord,
  })

  const filters = normalizeCustomFieldFilters(query)
  if (!filters.length) {
    return items.map((item) => appendCustomFields(item, profileByEntityId, cfValues))
  }

  const filtered = items.filter((item) => {
    const entityId = typeof item?.id === 'string' ? item.id : null
    if (!entityId) return false
    return recordMatchesFilters(entityId, filters, profileByEntityId, cfValues)
  })

  return filtered.map((item) => appendCustomFields(item, profileByEntityId, cfValues))
}
