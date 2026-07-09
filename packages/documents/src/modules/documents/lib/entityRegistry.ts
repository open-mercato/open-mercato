export type DocumentEntityType = 'customer-person' | 'customer-company' | 'deal' | 'product' | 'quote'

export type EntityPickerItem = {
  id: string
  label: string
  subtitle?: string
}

export type EntityTokenField = {
  field: string
  labelKey: string
  extract: (item: Record<string, unknown>) => string | null
}

export type EntityRegistryEntry = {
  type: DocumentEntityType
  labelKey: string
  searchPath: string
  mapItem: (item: Record<string, unknown>) => EntityPickerItem | null
  href: (id: string) => string
  tokenFields: EntityTokenField[]
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function readString(item: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

function readTextValue(item: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return null
}

function optionalSubtitle(value: string | null): string | undefined {
  return value ?? undefined
}

function mapCustomerItem(item: Record<string, unknown>): EntityPickerItem | null {
  const id = readString(item, 'id')
  const email = readString(item, 'email', 'primaryEmail', 'primary_email')
  const label = readString(item, 'name', 'displayName', 'display_name') ?? email
  if (!id || !label) return null
  return {
    id,
    label,
    subtitle: optionalSubtitle(email),
  }
}

function mapDealItem(item: Record<string, unknown>): EntityPickerItem | null {
  const id = readString(item, 'id')
  const label = readString(item, 'title')
  if (!id || !label) return null
  return {
    id,
    label,
    subtitle: optionalSubtitle(readString(item, 'status')),
  }
}

function mapProductItem(item: Record<string, unknown>): EntityPickerItem | null {
  const id = readString(item, 'id')
  const label = readString(item, 'title')
  if (!id || !label) return null
  return {
    id,
    label,
    subtitle: optionalSubtitle(readString(item, 'sku')),
  }
}

function mapQuoteItem(item: Record<string, unknown>): EntityPickerItem | null {
  const id = readString(item, 'id')
  const label = readString(item, 'quoteNumber', 'quote_number', 'number', 'title')
  if (!id || !label) return null
  return {
    id,
    label,
    subtitle: optionalSubtitle(readString(item, 'status')),
  }
}

function field(field: string, labelKey: string, keys: string[]): EntityTokenField {
  return {
    field,
    labelKey,
    extract: (item) => readTextValue(item, ...keys),
  }
}

export function readItemsArray(response: unknown): Record<string, unknown>[] {
  if (Array.isArray(response)) {
    return response.map(readRecord).filter((item): item is Record<string, unknown> => item !== null)
  }

  const record = readRecord(response)
  const candidates = [record?.items, record?.data]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.map(readRecord).filter((item): item is Record<string, unknown> => item !== null)
    }
  }
  return []
}

export const DOCUMENT_ENTITY_REGISTRY: EntityRegistryEntry[] = [
  {
    type: 'customer-person',
    labelKey: 'documents.entities.customerPerson',
    searchPath: '/api/customers/people',
    mapItem: mapCustomerItem,
    href: (id) => `/backend/customers/people/${id}`,
    tokenFields: [
      field('name', 'documents.entityFields.name', ['name', 'displayName', 'display_name']),
      field('email', 'documents.entityFields.email', ['email', 'primaryEmail', 'primary_email']),
      field('phone', 'documents.entityFields.phone', ['phone', 'primaryPhone', 'primary_phone']),
    ],
  },
  {
    type: 'customer-company',
    labelKey: 'documents.entities.customerCompany',
    searchPath: '/api/customers/companies',
    mapItem: mapCustomerItem,
    href: (id) => `/backend/customers/companies/${id}`,
    tokenFields: [
      field('name', 'documents.entityFields.name', ['name', 'displayName', 'display_name']),
      field('email', 'documents.entityFields.email', ['email', 'primaryEmail', 'primary_email']),
      field('phone', 'documents.entityFields.phone', ['phone', 'primaryPhone', 'primary_phone']),
    ],
  },
  {
    type: 'deal',
    labelKey: 'documents.entities.deal',
    searchPath: '/api/customers/deals',
    mapItem: mapDealItem,
    href: (id) => `/backend/customers/deals/${id}`,
    tokenFields: [
      field('title', 'documents.entityFields.title', ['title']),
      field('status', 'documents.entityFields.status', ['status']),
      field('value', 'documents.entityFields.value', ['value', 'valueAmount', 'value_amount']),
      field('valueCurrency', 'documents.entityFields.valueCurrency', ['valueCurrency', 'value_currency']),
    ],
  },
  {
    type: 'product',
    labelKey: 'documents.entities.product',
    searchPath: '/api/catalog/products',
    mapItem: mapProductItem,
    href: (id) => `/backend/catalog/products/${id}`,
    tokenFields: [
      field('title', 'documents.entityFields.title', ['title']),
      field('subtitle', 'documents.entityFields.subtitle', ['subtitle']),
      field('sku', 'documents.entityFields.sku', ['sku']),
    ],
  },
  {
    type: 'quote',
    labelKey: 'documents.entities.quote',
    searchPath: '/api/sales/quotes',
    mapItem: mapQuoteItem,
    href: (id) => `/backend/sales/quotes/${id}`,
    tokenFields: [
      field('number', 'documents.entityFields.number', ['quoteNumber', 'quote_number', 'number']),
      field('status', 'documents.entityFields.status', ['status']),
    ],
  },
]

export function getEntityRegistryEntry(type: string): EntityRegistryEntry | null {
  return DOCUMENT_ENTITY_REGISTRY.find((entry) => entry.type === type) ?? null
}
