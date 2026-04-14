import { getEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'

export type ResolvedValueDisplay = {
  label: string
  href?: string
}

export type RelationOptionsMetadata = {
  entityId: string
}

export type RelationOptionsResponse = {
  items?: Array<{
    value?: unknown
    label?: unknown
    routeContext?: Record<string, unknown>
  }>
}

export function normalizeTextValue(input: unknown): string | null {
  if (typeof input === 'string') {
    const trimmed = input.trim()
    return trimmed.length ? trimmed : null
  }
  if (typeof input === 'number' || typeof input === 'boolean') {
    return String(input)
  }
  return null
}

export function extractOptionLookupKey(entry: unknown): string | null {
  if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
    return normalizeTextValue(entry)
  }
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  return (
    normalizeTextValue(record.value)
    ?? normalizeTextValue(record.id)
    ?? normalizeTextValue(record.key)
    ?? normalizeTextValue(record.name)
    ?? null
  )
}

export function extractInlineOptionLabel(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  return (
    normalizeTextValue(record.label)
    ?? normalizeTextValue(record.name)
    ?? null
  )
}

export function collectRelationValueIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((entry) => extractOptionLookupKey(entry))
          .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0),
      ),
    )
  }
  const single = extractOptionLookupKey(value)
  return single ? [single] : []
}

function camelToSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function snakeToCamel(value: string): string {
  return value.replace(/[_-](\w)/g, (_, char: string) => char.toUpperCase())
}

export function readRecordValue(record: Record<string, unknown>, field: string): string | null {
  if (!field) return null
  const direct = normalizeTextValue(record[field])
  if (direct) return direct
  const snake = camelToSnake(field)
  const snakeValue = normalizeTextValue(record[snake])
  if (snakeValue) return snakeValue
  const camel = snakeToCamel(field)
  return normalizeTextValue(record[camel])
}

export function parseRelationOptionsMetadata(optionsUrl?: string): RelationOptionsMetadata | null {
  if (!optionsUrl) return null
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const url = new URL(optionsUrl, origin)
    if (!url.pathname.endsWith('/api/entities/relations/options')) return null
    const entityId = url.searchParams.get('entityId')?.trim()
    if (!entityId) return null
    return { entityId }
  } catch {
    return null
  }
}

export function getRelationHrefContextFields(entityId: string): string[] {
  const trimmedEntityId = entityId.trim()
  if (!trimmedEntityId) return []

  const knownEntityIds = getEntityIds(false)
  const customers = knownEntityIds.customers ?? {}
  const catalog = knownEntityIds.catalog ?? {}

  if (trimmedEntityId === customers.customer_entity) {
    return ['kind']
  }
  if (
    trimmedEntityId === customers.customer_person_profile
    || trimmedEntityId === customers.customer_company_profile
  ) {
    return ['entity_id']
  }
  if (trimmedEntityId === catalog.catalog_product_variant) {
    return ['product_id']
  }

  return []
}

export function buildRelationHref(entityId: string, recordId: string, record?: Record<string, unknown>): string | undefined {
  const trimmedEntityId = entityId.trim()
  const trimmedRecordId = recordId.trim()
  if (!trimmedEntityId || !trimmedRecordId) return undefined

  const knownEntityIds = getEntityIds(false)
  const customers = knownEntityIds.customers ?? {}
  const catalog = knownEntityIds.catalog ?? {}
  const sales = knownEntityIds.sales ?? {}
  const staff = knownEntityIds.staff ?? {}
  const resources = knownEntityIds.resources ?? {}
  const knownEntityIdSet = new Set(
    Object.values(knownEntityIds).flatMap((group) => Object.values(group ?? {})),
  )
  const canUseCustomEntityFallback =
    knownEntityIdSet.size > 0
      ? !knownEntityIdSet.has(trimmedEntityId)
      : trimmedEntityId.startsWith('virtual:')

  if (trimmedEntityId === customers.customer_entity) {
    const kind = (readRecordValue(record ?? {}, 'kind') ?? '').toLowerCase()
    if (kind === 'person') return `/backend/customers/people-v2/${encodeURIComponent(trimmedRecordId)}`
    if (kind === 'company') return `/backend/customers/companies-v2/${encodeURIComponent(trimmedRecordId)}`
    return undefined
  }
  if (trimmedEntityId === customers.customer_person_profile) {
    const linkedId = readRecordValue(record ?? {}, 'entity_id') ?? trimmedRecordId
    return `/backend/customers/people-v2/${encodeURIComponent(linkedId)}`
  }
  if (trimmedEntityId === customers.customer_company_profile) {
    const linkedId = readRecordValue(record ?? {}, 'entity_id') ?? trimmedRecordId
    return `/backend/customers/companies-v2/${encodeURIComponent(linkedId)}`
  }
  if (trimmedEntityId === customers.customer_deal) {
    return `/backend/customers/deals/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === catalog.catalog_product) {
    return `/backend/catalog/products/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === catalog.catalog_category) {
    return `/backend/catalog/categories/${encodeURIComponent(trimmedRecordId)}/edit`
  }
  if (trimmedEntityId === catalog.catalog_product_variant) {
    const productId = readRecordValue(record ?? {}, 'product_id')
    if (!productId) return undefined
    return `/backend/catalog/products/${encodeURIComponent(productId)}/variants/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === sales.sales_quote) {
    return `/backend/sales/quotes/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === sales.sales_order) {
    return `/backend/sales/orders/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === sales.sales_channel) {
    return `/backend/sales/channels/${encodeURIComponent(trimmedRecordId)}/edit`
  }
  if (trimmedEntityId === staff.staff_team_member) {
    return `/backend/staff/team-members/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === staff.staff_team_role) {
    return `/backend/staff/team-roles/${encodeURIComponent(trimmedRecordId)}/edit`
  }
  if (trimmedEntityId === staff.staff_team) {
    return `/backend/staff/teams/${encodeURIComponent(trimmedRecordId)}/edit`
  }
  if (trimmedEntityId === staff.staff_leave_request) {
    return `/backend/staff/leave-requests/${encodeURIComponent(trimmedRecordId)}`
  }
  if (trimmedEntityId === resources.resources_resource) {
    return `/backend/resources/resources/${encodeURIComponent(trimmedRecordId)}`
  }

  if (canUseCustomEntityFallback) {
    return `/backend/entities/user/${encodeURIComponent(trimmedEntityId)}/records/${encodeURIComponent(trimmedRecordId)}`
  }

  return undefined
}

export function buildRelationLookupUrl(
  optionsUrl: string,
  recordIds: string[],
  routeContextFields: string[] = [],
): string | null {
  if (!recordIds.length) return null
  try {
    const isAbsolute = /^([a-z][a-z\d+\-.]*:)?\/\//i.test(optionsUrl)
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost'
    const url = isAbsolute ? new URL(optionsUrl) : new URL(optionsUrl, origin)
    url.searchParams.set('ids', recordIds.join(','))
    if (routeContextFields.length > 0) {
      url.searchParams.set('routeContextFields', routeContextFields.join(','))
    }
    if (isAbsolute) return url.toString()
    return `${url.pathname}${url.search}`
  } catch {
    const sep = optionsUrl.includes('?') ? '&' : '?'
    const params = [`ids=${encodeURIComponent(recordIds.join(','))}`]
    if (routeContextFields.length > 0) {
      params.push(`routeContextFields=${encodeURIComponent(routeContextFields.join(','))}`)
    }
    return `${optionsUrl}${sep}${params.join('&')}`
  }
}

export async function fetchRelationRecordDisplays(
  optionsUrl: string,
  relation: RelationOptionsMetadata,
  recordIds: string[],
  signal?: AbortSignal,
): Promise<Record<string, ResolvedValueDisplay>> {
  const displays: Record<string, ResolvedValueDisplay> = {}
  if (!recordIds.length) return displays
  const routeContextFields = getRelationHrefContextFields(relation.entityId)

  const uniqueIds = Array.from(new Set(recordIds.map((entry) => entry.trim()).filter((entry) => entry.length > 0)))
  const chunks: string[][] = []
  for (let index = 0; index < uniqueIds.length; index += 100) {
    chunks.push(uniqueIds.slice(index, index + 100))
  }

  for (const chunk of chunks) {
    if (signal?.aborted) break

    const url = buildRelationLookupUrl(optionsUrl, chunk, routeContextFields)
    if (!url) {
      chunk.forEach((recordId) => {
        displays[recordId] = {
          label: recordId,
          href: buildRelationHref(relation.entityId, recordId),
        }
      })
      continue
    }

    const response = await readApiResultOrThrow<RelationOptionsResponse>(
      url,
      signal ? { signal } : undefined,
      {
        errorMessage: 'Failed to resolve relation values',
        fallback: { items: [] },
      },
    )
    const items = Array.isArray(response?.items) ? response.items : []
    const resolvedIds = new Set<string>()

    items.forEach((item) => {
      const recordId = normalizeTextValue(item?.value)
      if (!recordId) return
      resolvedIds.add(recordId)
      const label = normalizeTextValue(item?.label) ?? recordId
      const routeContext =
        item?.routeContext && typeof item.routeContext === 'object' && !Array.isArray(item.routeContext)
          ? item.routeContext
          : undefined
      displays[recordId] = {
        label,
        href: buildRelationHref(relation.entityId, recordId, routeContext),
      }
    })

    chunk.forEach((recordId) => {
      if (resolvedIds.has(recordId) || displays[recordId]) return
      displays[recordId] = {
        label: recordId,
        href: buildRelationHref(relation.entityId, recordId),
      }
    })
  }

  return displays
}
