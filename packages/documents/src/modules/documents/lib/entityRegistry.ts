import type { DocumentEntityType } from '../data/validators'
import {
  firstSafeDocumentsDisplayLabel,
  sanitizeDocumentsDisplayLabel,
} from './displayLabels'

export type { DocumentEntityType } from '../data/validators'

export type EntityPickerItem = {
  id: string
  label: string
  subtitle?: string
  href?: string
  archivedAt?: string | null
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

/**
 * Internal registry contract used by Documents integrations. Keep the
 * long-standing EntityRegistryEntry shape above assignable for deep-import
 * consumers while requiring every built-in entry to declare its capability
 * and canonical-link policy.
 */
export type DocumentEntityRegistryEntry = EntityRegistryEntry & {
  resolveHref: (item: EntityPickerItem) => string | null
  isCanonicalHref: (item: Pick<EntityPickerItem, 'id' | 'href'>, href: string) => boolean
  requiredModule: string
  /**
   * Module that owns `requiredFeature`. This is usually the same as
   * `requiredModule`, but catalog offers are rendered by Catalog while their
   * channel-access feature is owned by Sales. Keeping it explicit lets the
   * server and ClientBootstrap-backed picker make the same fail-closed choice.
   */
  requiredFeatureModule: string
  requiredFeature: string
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(item: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return null
}

/**
 * Cross-module records are an untrusted display boundary. Their identifiers
 * remain available to the registry for canonical routing, but a name, status,
 * SKU, or other rendered value must never fall back to an identifier-shaped
 * string. Continue through aliases so a malformed preferred field does not
 * hide a later readable value.
 */
function readDisplayString(item: Record<string, unknown>, ...keys: string[]): string | null {
  return firstSafeDocumentsDisplayLabel(...keys.map((key) => item[key]))
}

function readNestedString(
  item: Record<string, unknown>,
  parentKey: string,
  ...keys: string[]
): string | null {
  const parent = readRecord(item[parentKey])
  return parent ? readString(parent, ...keys) : null
}

function readNestedDisplayString(
  item: Record<string, unknown>,
  parentKey: string,
  ...keys: string[]
): string | null {
  const parent = readRecord(item[parentKey])
  return parent ? readDisplayString(parent, ...keys) : null
}

function readDisplayTextValue(item: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = item[key]
    const safe = typeof value === 'number' && Number.isFinite(value)
      ? sanitizeDocumentsDisplayLabel(String(value))
      : sanitizeDocumentsDisplayLabel(value)
    if (safe) return safe
  }
  return null
}

function optionalSubtitle(value: string | null): string | undefined {
  return value ?? undefined
}

function mapCustomerItem(item: Record<string, unknown>): EntityPickerItem | null {
  const id = readString(item, 'id')
  const email = readDisplayString(item, 'email', 'primaryEmail', 'primary_email')
  const label = readDisplayString(item, 'name', 'displayName', 'display_name') ?? email
  if (!id || !label) return null
  return { id, label, subtitle: optionalSubtitle(email) }
}

function mapDealItem(item: Record<string, unknown>): EntityPickerItem | null {
  const id = readString(item, 'id')
  const label = readDisplayString(item, 'title')
  if (!id || !label) return null
  return { id, label, subtitle: optionalSubtitle(readDisplayString(item, 'status')) }
}

function mapProductItem(item: Record<string, unknown>): EntityPickerItem | null {
  const id = readString(item, 'id')
  const label = readDisplayString(item, 'title')
  if (!id || !label) return null
  return { id, label, subtitle: optionalSubtitle(readDisplayString(item, 'sku')) }
}

function mapCatalogOfferItem(item: Record<string, unknown>): EntityPickerItem | null {
  const id = readString(item, 'id')
  const productId = readString(item, 'productId', 'product_id')
    ?? readNestedString(item, 'product', 'id')
  const productTitle = readNestedDisplayString(item, 'product', 'title', 'name')
  const label = readDisplayString(item, 'title', 'name') ?? productTitle
  if (!id || !productId || !label) return null
  const productSku = readNestedDisplayString(item, 'product', 'sku')
  return {
    id,
    label,
    subtitle: optionalSubtitle(productTitle ?? productSku),
    href: `/backend/catalog/products/${productId}`,
  }
}

function mapSalesDocumentItem(
  item: Record<string, unknown>,
  numberKeys: string[],
): EntityPickerItem | null {
  const id = readString(item, 'id')
  const label = readDisplayString(item, ...numberKeys, 'number', 'title')
  if (!id || !label) return null
  return { id, label, subtitle: optionalSubtitle(readDisplayString(item, 'status')) }
}

function mapDocumentItem(item: Record<string, unknown>): EntityPickerItem | null {
  const id = readString(item, 'id')
  const label = readDisplayString(item, 'title')
  if (!id || !label) return null
  const archivedAt = item.archivedAt ?? item.archived_at
  return {
    id,
    label,
    archivedAt: typeof archivedAt === 'string' && archivedAt.length > 0 ? archivedAt : null,
  }
}

function field(fieldName: string, labelKey: string, keys: string[]): EntityTokenField {
  return {
    field: fieldName,
    labelKey,
    extract: (item) => readDisplayTextValue(item, ...keys),
  }
}

function exactIdPath(pathPrefix: string, id: string): string {
  return `${pathPrefix}/${id}`
}

const CATALOG_PRODUCT_HREF_PATTERN =
  /^\/backend\/catalog\/products\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function buildIdAddressableEntry(
  input: Omit<DocumentEntityRegistryEntry, 'resolveHref' | 'isCanonicalHref'>,
): DocumentEntityRegistryEntry {
  return {
    ...input,
    resolveHref: (item) => input.href(item.id),
    isCanonicalHref: (item, href) => href === input.href(item.id),
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

export const DOCUMENT_ENTITY_REGISTRY: DocumentEntityRegistryEntry[] = [
  buildIdAddressableEntry({
    type: 'customer-person',
    labelKey: 'documents.entities.customerPerson',
    searchPath: '/api/customers/people',
    mapItem: mapCustomerItem,
    href: (id) => exactIdPath('/backend/customers/people', id),
    requiredModule: 'customers',
    requiredFeatureModule: 'customers',
    requiredFeature: 'customers.people.view',
    tokenFields: [
      field('name', 'documents.entityFields.name', ['name', 'displayName', 'display_name']),
      field('email', 'documents.entityFields.email', ['email', 'primaryEmail', 'primary_email']),
      field('phone', 'documents.entityFields.phone', ['phone', 'primaryPhone', 'primary_phone']),
    ],
  }),
  buildIdAddressableEntry({
    type: 'customer-company',
    labelKey: 'documents.entities.customerCompany',
    searchPath: '/api/customers/companies',
    mapItem: mapCustomerItem,
    href: (id) => exactIdPath('/backend/customers/companies', id),
    requiredModule: 'customers',
    requiredFeatureModule: 'customers',
    requiredFeature: 'customers.companies.view',
    tokenFields: [
      field('name', 'documents.entityFields.name', ['name', 'displayName', 'display_name']),
      field('email', 'documents.entityFields.email', ['email', 'primaryEmail', 'primary_email']),
      field('phone', 'documents.entityFields.phone', ['phone', 'primaryPhone', 'primary_phone']),
    ],
  }),
  buildIdAddressableEntry({
    type: 'deal',
    labelKey: 'documents.entities.deal',
    searchPath: '/api/customers/deals',
    mapItem: mapDealItem,
    href: (id) => exactIdPath('/backend/customers/deals', id),
    requiredModule: 'customers',
    requiredFeatureModule: 'customers',
    requiredFeature: 'customers.deals.view',
    tokenFields: [
      field('title', 'documents.entityFields.title', ['title']),
      field('status', 'documents.entityFields.status', ['status']),
      field('value', 'documents.entityFields.value', ['value', 'valueAmount', 'value_amount']),
      field('valueCurrency', 'documents.entityFields.valueCurrency', ['valueCurrency', 'value_currency']),
    ],
  }),
  buildIdAddressableEntry({
    type: 'product',
    labelKey: 'documents.entities.product',
    searchPath: '/api/catalog/products',
    mapItem: mapProductItem,
    href: (id) => exactIdPath('/backend/catalog/products', id),
    requiredModule: 'catalog',
    requiredFeatureModule: 'catalog',
    requiredFeature: 'catalog.products.view',
    tokenFields: [
      field('title', 'documents.entityFields.title', ['title']),
      field('subtitle', 'documents.entityFields.subtitle', ['subtitle']),
      field('sku', 'documents.entityFields.sku', ['sku']),
    ],
  }),
  {
    type: 'catalog-offer',
    labelKey: 'documents.entities.catalogOffer',
    searchPath: '/api/catalog/offers',
    mapItem: mapCatalogOfferItem,
    href: () => '',
    resolveHref: (item) => {
      const href = item.href ?? null
      return href && CATALOG_PRODUCT_HREF_PATTERN.test(href) ? href : null
    },
    isCanonicalHref: (item, href) => Boolean(item.href && href === item.href && CATALOG_PRODUCT_HREF_PATTERN.test(href)),
    requiredModule: 'catalog',
    requiredFeatureModule: 'sales',
    requiredFeature: 'sales.channels.manage',
    tokenFields: [
      field('title', 'documents.entityFields.title', ['title', 'name']),
      field('description', 'documents.entityFields.description', ['description']),
    ],
  },
  buildIdAddressableEntry({
    type: 'quote',
    labelKey: 'documents.entities.quote',
    searchPath: '/api/sales/quotes',
    mapItem: (item) => mapSalesDocumentItem(item, ['quoteNumber', 'quote_number']),
    href: (id) => exactIdPath('/backend/sales/quotes', id),
    requiredModule: 'sales',
    requiredFeatureModule: 'sales',
    requiredFeature: 'sales.quotes.view',
    tokenFields: [
      field('number', 'documents.entityFields.number', ['quoteNumber', 'quote_number', 'number']),
      field('status', 'documents.entityFields.status', ['status']),
      field('total', 'documents.entityFields.total', ['grandTotalGross', 'grand_total_gross', 'total']),
      field('currency', 'documents.entityFields.currency', ['currencyCode', 'currency_code']),
    ],
  }),
  buildIdAddressableEntry({
    type: 'sales-order',
    labelKey: 'documents.entities.salesOrder',
    searchPath: '/api/sales/orders',
    mapItem: (item) => mapSalesDocumentItem(item, ['orderNumber', 'order_number']),
    href: (id) => exactIdPath('/backend/sales/orders', id),
    requiredModule: 'sales',
    requiredFeatureModule: 'sales',
    requiredFeature: 'sales.orders.view',
    tokenFields: [
      field('number', 'documents.entityFields.number', ['orderNumber', 'order_number', 'number']),
      field('status', 'documents.entityFields.status', ['status']),
      field('total', 'documents.entityFields.total', ['grandTotalGross', 'grand_total_gross', 'total']),
      field('currency', 'documents.entityFields.currency', ['currencyCode', 'currency_code']),
    ],
  }),
  buildIdAddressableEntry({
    type: 'document',
    labelKey: 'documents.entities.document',
    searchPath: '/api/documents',
    mapItem: mapDocumentItem,
    href: (id) => exactIdPath('/backend/documents', id),
    requiredModule: 'documents',
    requiredFeatureModule: 'documents',
    requiredFeature: 'documents.view',
    tokenFields: [
      field('title', 'documents.entityFields.title', ['title']),
    ],
  }),
]

export function getEntityRegistryEntry(type: string): DocumentEntityRegistryEntry | null {
  return DOCUMENT_ENTITY_REGISTRY.find((entry) => entry.type === type) ?? null
}

export function getEntityTokenFieldNames(type: DocumentEntityType): Set<string> {
  const entry = getEntityRegistryEntry(type)
  return new Set(entry?.tokenFields.map((tokenField) => tokenField.field) ?? [])
}
