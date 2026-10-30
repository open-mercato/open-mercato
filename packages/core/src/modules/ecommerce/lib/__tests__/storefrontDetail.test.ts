import type { AwilixContainer } from 'awilix'
import {
  availabilityItemKey,
  availabilityProviderRegistry,
  type AvailabilityQuery,
  type AvailabilityState,
} from '@open-mercato/shared/lib/availability'
import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { normalizeFilters, type NormalizedFilter } from '@open-mercato/shared/lib/query/join-utils'
import type { QueryOptions, Where } from '@open-mercato/shared/lib/query/types'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductPrice,
} from '@open-mercato/core/modules/catalog/data/entities'
import { DefaultCatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { batchLoadTranslationsMany } from '@open-mercato/core/modules/translations/lib/batch'
import {
  optionChoiceLabelTranslationField as catalogChoiceLabelField,
  optionLabelTranslationField as catalogOptionLabelField,
} from '@open-mercato/core/modules/catalog/lib/optionSchemaTranslations'
import { ecommerceStoreSettingsSchema } from '../../data/validators'
import { buildStorefrontProductScope, composeStorefrontProductFilters } from '../storefrontProductScope'
import {
  getStorefrontProductDetail,
  optionChoiceLabelTranslationField,
  optionLabelTranslationField,
  STOREFRONT_RELATED_PRODUCTS_LIMIT,
} from '../storefrontDetail'
import type { BuyerContext, StoreContext } from '../types'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/translations/lib/batch', () => ({
  batchLoadTranslations: jest.fn(),
  batchLoadTranslationsMany: jest.fn(),
}))

const mockedFind = findWithDecryption as jest.Mock
const mockedTranslations = batchLoadTranslationsMany as jest.Mock

const TENANT_ID = 'tenant-1'
const ORGANIZATION_ID = 'org-1'
const NOW = new Date('2026-10-05T12:00:00Z')

const CAT_ROOT = '0b8f3f0e-1d2a-4c5b-8e6f-000000000001'
const CAT_DRESS = '0b8f3f0e-1d2a-4c5b-8e6f-000000000002'
const CAT_SHOES = '0b8f3f0e-1d2a-4c5b-8e6f-000000000003'
const TAG_SALE = '0b8f3f0e-1d2a-4c5b-8e6f-000000000011'
const TAG_HIDDEN = '0b8f3f0e-1d2a-4c5b-8e6f-000000000012'
const TEMPLATE_ID = '0b8f3f0e-1d2a-4c5b-8e6f-000000000021'

const MAIN_ID = '1a000000-0000-4000-8000-000000000001'
const SIBLING_ID = '1a000000-0000-4000-8000-000000000002'
const COUSIN_ID = '1a000000-0000-4000-8000-000000000003'
const SHOE_ID = '1a000000-0000-4000-8000-000000000004'
const INACTIVE_ID = '1a000000-0000-4000-8000-000000000005'
const DELETED_ID = '1a000000-0000-4000-8000-000000000006'
const FOREIGN_ID = '1a000000-0000-4000-8000-000000000007'
const PLAIN_ID = '1a000000-0000-4000-8000-000000000008'
const ROOTED_ID = '1a000000-0000-4000-8000-000000000009'

const REGULAR_KIND = { id: 'pk-regular', code: 'regular', isPromotion: false, displayMode: 'including-tax' }

const RESTRICTED_SCOPE: EffectiveAssortmentScope = [{ categoryIds: [CAT_ROOT], excludeTagIds: [TAG_HIDDEN] }]

type CategoryFixture = {
  id: string
  name: string
  slug: string
  ancestorIds: string[]
  descendantIds: string[]
  isActive: boolean
  deletedAt: Date | null
  tenantId: string
  organizationId: string
}

function category(id: string, slug: string, name: string, ancestorIds: string[], descendantIds: string[]): CategoryFixture {
  return { id, name, slug, ancestorIds, descendantIds, isActive: true, deletedAt: null, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
}

const CATEGORIES: CategoryFixture[] = [
  category(CAT_ROOT, 'clothing', 'Clothing', [], [CAT_DRESS]),
  category(CAT_DRESS, 'dresses', 'Dresses', [CAT_ROOT], []),
  category(CAT_SHOES, 'shoes', 'Shoes', [], []),
]

const TAGS = [
  { id: TAG_SALE, slug: 'sale', label: 'Sale', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
  { id: TAG_HIDDEN, slug: 'hidden', label: 'Hidden', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
]

const OPTION_TEMPLATE = {
  id: TEMPLATE_ID,
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
  name: 'Dress options',
  code: 'dress',
  description: null,
  isActive: true,
  deletedAt: null,
  schema: {
    name: 'Dress options',
    options: [
      {
        code: 'color',
        label: 'Color',
        inputType: 'select',
        choices: [
          { code: 'red', label: 'Red' },
          { code: 'blue', label: 'Blue' },
        ],
      },
    ],
  },
}

type ProductFixture = {
  id: string
  handle: string
  title: string
  createdAt: string
  categoryIds: string[]
  tagIds: string[]
  variantCount: number
  tenantId?: string
  isActive?: boolean
  deletedAt?: Date | null
  extra?: Record<string, unknown>
}

const MAIN_DESCRIPTION = '<p>Light <strong>linen</strong></p><script>alert(1)</script><img src="x.png" onerror="alert(2)">'

function baseProducts(mainVariantCount: number): ProductFixture[] {
  return [
    {
      id: MAIN_ID,
      handle: 'summer-dress',
      title: 'Summer Dress',
      createdAt: '2026-01-01',
      categoryIds: [CAT_DRESS],
      tagIds: [TAG_SALE],
      variantCount: mainVariantCount,
      extra: {
        description: MAIN_DESCRIPTION,
        sku: 'SD-1',
        productType: 'configurable',
        isConfigurable: true,
        weightValue: '0.4500',
        weightUnit: 'kg',
        dimensions: { width: 30, height: 2, depth: 40, unit: 'cm' },
        seoTitle: 'Summer Dress SEO',
        seoDescription: null,
        canonicalUrl: 'https://shop.example/summer-dress',
        minOrderQty: 3,
        optionSchemaTemplate: OPTION_TEMPLATE,
        defaultMediaId: 'media-2',
        defaultMediaUrl: '/media/main.jpg',
      },
    },
    { id: SIBLING_ID, handle: 'sibling', title: 'Sibling Dress', createdAt: '2026-02-01', categoryIds: [CAT_DRESS], tagIds: [], variantCount: 0 },
    { id: COUSIN_ID, handle: 'cousin', title: 'Cousin Dress', createdAt: '2026-03-01', categoryIds: [CAT_DRESS], tagIds: [TAG_HIDDEN], variantCount: 0 },
    { id: SHOE_ID, handle: 'shoe', title: 'Shoe', createdAt: '2026-04-01', categoryIds: [CAT_SHOES], tagIds: [], variantCount: 0 },
    { id: INACTIVE_ID, handle: 'inactive-dress', title: 'Inactive', createdAt: '2026-05-01', categoryIds: [CAT_DRESS], tagIds: [], variantCount: 0, isActive: false },
    { id: DELETED_ID, handle: 'deleted-dress', title: 'Deleted', createdAt: '2026-06-01', categoryIds: [CAT_DRESS], tagIds: [], variantCount: 0, deletedAt: new Date('2026-09-01') },
    { id: FOREIGN_ID, handle: 'foreign', title: 'Foreign', createdAt: '2026-07-01', categoryIds: [CAT_DRESS], tagIds: [], variantCount: 0, tenantId: 'tenant-2' },
    { id: PLAIN_ID, handle: 'plain', title: 'Plain', createdAt: '2026-08-01', categoryIds: [], tagIds: [], variantCount: mainVariantCount },
    { id: ROOTED_ID, handle: 'rooted', title: 'Rooted', createdAt: '2026-08-15', categoryIds: [CAT_ROOT], tagIds: [], variantCount: 0 },
  ]
}

function variantId(productId: string, index: number): string {
  return `variant-${productId.slice(-4)}-${index}`
}

function variantsOf(product: ProductFixture) {
  return Array.from({ length: product.variantCount }, (_, index) => ({
    id: variantId(product.id, index),
    product: { id: product.id },
    name: `Variant ${index + 1}`,
    sku: `${product.handle}-${index + 1}`,
    isDefault: index === 1,
    isActive: true,
    deletedAt: null,
    optionValues: { color: index % 2 === 0 ? 'red' : 'blue', stock: 3 },
    weightValue: '0.5000',
    weightUnit: 'kg',
    dimensions: null,
    tenantId: product.tenantId ?? TENANT_ID,
    organizationId: ORGANIZATION_ID,
  }))
}

function productEntity(product: ProductFixture) {
  return {
    id: product.id,
    tenantId: product.tenantId ?? TENANT_ID,
    organizationId: ORGANIZATION_ID,
    title: product.title,
    subtitle: null,
    handle: product.handle,
    sku: null,
    description: null,
    productType: 'simple',
    isConfigurable: false,
    isActive: product.isActive ?? true,
    deletedAt: product.deletedAt ?? null,
    defaultMediaId: null,
    defaultMediaUrl: null,
    weightValue: null,
    weightUnit: null,
    dimensions: null,
    seoTitle: null,
    seoDescription: null,
    canonicalUrl: null,
    minOrderQty: null,
    maxOrderQty: null,
    orderQtyIncrement: null,
    optionSchemaTemplate: null,
    ...product.extra,
    variants: variantsOf(product),
    categoryAssignments: product.categoryIds.map((categoryId, position) => ({
      position,
      category: CATEGORIES.find((entry) => entry.id === categoryId),
    })),
    tagAssignments: product.tagIds.map((tagId) => ({ tag: TAGS.find((entry) => entry.id === tagId) })),
  }
}

type IndexRow = Record<string, unknown> & { id: string }

function indexRow(product: ProductFixture): IndexRow {
  const scopeKeys = new Set<string>()
  for (const categoryId of product.categoryIds) {
    scopeKeys.add(`cat:${categoryId}`)
    for (const ancestorId of CATEGORIES.find((entry) => entry.id === categoryId)?.ancestorIds ?? []) {
      scopeKeys.add(`cat:${ancestorId}`)
    }
  }
  for (const tagId of product.tagIds) scopeKeys.add(`tag:${tagId}`)
  return {
    id: product.id,
    tenant_id: product.tenantId ?? TENANT_ID,
    organization_id: ORGANIZATION_ID,
    deleted_at: product.deletedAt ?? null,
    is_active: product.isActive ?? true,
    handle: product.handle,
    title: product.title,
    created_at: new Date(`${product.createdAt}T00:00:00Z`),
    scope_keys: Array.from(scopeKeys),
  }
}

type PriceInput = { id: string; productId?: string; variantId?: string; gross: string; minQuantity?: number }

function priceRow(input: PriceInput) {
  return {
    id: input.id,
    product: input.variantId ? null : { id: input.productId },
    variant: input.variantId ? { id: input.variantId, product: { id: input.productId } } : null,
    offer: null,
    priceKind: { ...REGULAR_KIND },
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    currencyCode: 'EUR',
    kind: REGULAR_KIND.code,
    minQuantity: input.minQuantity ?? 1,
    maxQuantity: null,
    unitPriceNet: null,
    unitPriceGross: input.gross,
    taxRate: null,
    taxAmount: null,
    channelId: null,
    userId: null,
    userGroupId: null,
    customerId: null,
    customerGroupId: null,
    metadata: null,
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  }
}

const MEDIA_SCOPE = { entityId: 'catalog:catalog_product', recordId: MAIN_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

const MEDIA = [
  { id: 'media-1', ...MEDIA_SCOPE, url: '/files/one.jpg', partitionCode: 'productsMedia', mimeType: 'image/jpeg' },
  { id: 'media-2', ...MEDIA_SCOPE, url: '/files/two.jpg', partitionCode: 'productsMedia', mimeType: 'image/png' },
  { id: 'media-private', ...MEDIA_SCOPE, url: '/files/secret.jpg', partitionCode: 'privateAttachments', mimeType: 'image/jpeg' },
  { id: 'media-pdf', ...MEDIA_SCOPE, url: '/files/manual.pdf', partitionCode: 'productsMedia', mimeType: 'application/pdf' },
  { id: 'media-foreign', ...MEDIA_SCOPE, url: '/files/foreign.jpg', partitionCode: 'otherTenantMedia', mimeType: 'image/jpeg' },
]

const PARTITIONS = [
  { id: 'partition-public', code: 'productsMedia', isPublic: true, tenantId: null, organizationId: null },
  { id: 'partition-private', code: 'privateAttachments', isPublic: false, tenantId: null, organizationId: null },
  { id: 'partition-foreign', code: 'otherTenantMedia', isPublic: true, tenantId: 'tenant-other', organizationId: null },
]

const TRANSLATIONS: Record<string, Record<string, Record<string, Record<string, unknown>>>> = {
  'catalog:catalog_product': {
    [MAIN_ID]: {
      pl: { title: 'Sukienka letnia', description: '<p>Lniana</p><script>steal()</script><a href="javascript:alert(1)">x</a>' },
      en: { subtitle: 'Linen summer dress', title: 'Summer Dress EN' },
    },
    [SIBLING_ID]: { pl: { title: 'Siostrzana' } },
  },
  'catalog:catalog_product_variant': {},
  'catalog:catalog_product_category': {
    [CAT_DRESS]: { pl: { name: 'Sukienki' } },
  },
  'catalog:catalog_product_tag': {
    [TAG_SALE]: { en: { label: 'Sale EN' } },
  },
  'catalog:catalog_option_schema_template': {
    [TEMPLATE_ID]: {
      pl: {
        name: 'Opcje sukienki',
        [optionLabelTranslationField('color')]: 'Kolor',
        [optionChoiceLabelTranslationField('color', 'red')]: 'Czerwony',
      },
    },
  },
}

type World = {
  products: ProductFixture[]
  prices: ReturnType<typeof priceRow>[]
  availability: Record<string, { state: AvailabilityState; canFulfil: boolean }>
  hideWhenOutOfStock: Set<string>
  policy: { minOrderQuantity: number | null; maxOrderQuantity: number | null; quantityIncrement: number | null }
}

let world: World

const counters = { queryEngine: 0, find: 0, media: 0, translations: 0, availability: 0, policies: 0 }
const queryEngineCalls: QueryOptions[] = []

function resetCounters() {
  counters.queryEngine = 0
  counters.find = 0
  counters.media = 0
  counters.translations = 0
  counters.availability = 0
  counters.policies = 0
  queryEngineCalls.length = 0
}

function totalQueries(): number {
  return (
    counters.queryEngine +
    counters.find +
    counters.media +
    counters.translations +
    counters.availability +
    counters.policies
  )
}

function referenceValue(value: unknown): unknown {
  if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value) && 'id' in value) {
    return (value as { id: unknown }).id
  }
  return value ?? null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)
}

function matchesWhere(record: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === '$and') return (condition as Array<Record<string, unknown>>).every((part) => matchesWhere(record, part))
    if (key === '$or') return (condition as Array<Record<string, unknown>>).some((part) => matchesWhere(record, part))
    const actual = referenceValue(record[key])
    if (condition === null) return actual === null
    if (isPlainObject(condition)) {
      const operators = Object.keys(condition)
      if (operators.every((operator) => operator.startsWith('$'))) {
        return operators.every((operator) => {
          const operand = condition[operator]
          if (operator === '$in') return (operand as unknown[]).includes(actual)
          if (operator === '$nin') return !(operand as unknown[]).includes(actual)
          if (operator === '$eq') return actual === operand
          throw new Error(`[internal] fake find does not support ${operator}`)
        })
      }
      const nested = record[key]
      return isPlainObject(nested) && matchesWhere(nested, condition)
    }
    return actual === condition
  })
}

function evaluateLeaf(row: IndexRow, filter: NormalizedFilter): boolean {
  const actual = row[filter.field]
  const list = Array.isArray(filter.value) ? filter.value.map(String) : [String(filter.value)]
  switch (filter.op) {
    case 'eq':
      return filter.value === null ? actual === null || actual === undefined : actual === filter.value
    case 'in':
      return list.includes(String(actual))
    case 'nin':
      return !list.includes(String(actual))
    case 'exists':
      return filter.value ? actual !== undefined && actual !== null : actual === undefined || actual === null
    case 'overlap':
      return Array.isArray(actual) && actual.some((entry) => list.includes(String(entry)))
    case 'noverlap':
      return Array.isArray(actual) && !actual.some((entry) => list.includes(String(entry)))
    default:
      throw new Error(`[internal] fake query engine does not support ${filter.op}`)
  }
}

function rowMatches(row: IndexRow, filters: Where): boolean {
  const normalized = normalizeFilters(filters)
  const regular = normalized.filter((filter) => !filter.orGroup)
  if (!regular.every((filter) => evaluateLeaf(row, filter))) return false
  const groups = new Map<string, NormalizedFilter[]>()
  for (const filter of normalized) {
    if (!filter.orGroup) continue
    const group = groups.get(filter.orGroup) ?? []
    group.push(filter)
    groups.set(filter.orGroup, group)
  }
  if (groups.size === 0) return true
  return Array.from(groups.values()).some((group) => group.every((filter) => evaluateLeaf(row, filter)))
}

const queryEngine = {
  async query(_entity: string, options: QueryOptions = {}) {
    counters.queryEngine += 1
    queryEngineCalls.push(options)
    const rows = world.products.map(indexRow).filter((row) => {
      if (row.tenant_id !== options.tenantId || row.organization_id !== options.organizationId) return false
      return rowMatches(row, (options.filters ?? {}) as Where)
    })
    rows.sort((left, right) => {
      for (const sort of options.sort ?? []) {
        const diff = (left[sort.field] as Date).getTime() - (right[sort.field] as Date).getTime()
        if (diff !== 0) return sort.dir === 'desc' ? -diff : diff
      }
      return left.id.localeCompare(right.id)
    })
    const pageSize = options.page?.pageSize ?? 20
    const items = rows.slice(0, pageSize).map((row) => ({ id: row.id }))
    return { items, total: rows.length, page: 1, pageSize }
  },
}

function installFind() {
  mockedFind.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    counters.find += 1
    if (entity === CatalogProduct) {
      return world.products
        .map(productEntity)
        .filter((entry) => matchesWhere(entry as unknown as Record<string, unknown>, where))
    }
    if (entity === CatalogProductCategory) {
      return CATEGORIES.filter((entry) => matchesWhere(entry as unknown as Record<string, unknown>, where))
    }
    if (entity === Attachment) {
      return MEDIA.filter((entry) => matchesWhere(entry as unknown as Record<string, unknown>, where))
    }
    if (entity === AttachmentPartition) {
      return PARTITIONS.filter((entry) => matchesWhere(entry as unknown as Record<string, unknown>, where))
    }
    if (entity === CatalogProductPrice) {
      return world.prices.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where))
    }
    return []
  })
}

function installTranslations() {
  mockedTranslations.mockImplementation(
    async (_db: unknown, requests: Array<{ entityType: string; entityIds: string[] }>) => {
      counters.translations += 1
      const result = new Map<string, Map<string, Record<string, Record<string, unknown>>>>()
      for (const request of requests) {
        const source = TRANSLATIONS[request.entityType] ?? {}
        const map = new Map<string, Record<string, Record<string, unknown>>>()
        for (const id of request.entityIds) if (source[id]) map.set(id, source[id])
        result.set(request.entityType, map)
      }
      return result
    },
  )
}

availabilityProviderRegistry.register({
  id: 'test-provider',
  async getAvailability(query: AvailabilityQuery) {
    counters.availability += 1
    const byItem: Record<string, {
      state: AvailabilityState
      availableQuantity: number | null
      canFulfil: boolean
      leadTimeDays: number | null
      releaseAt: string | null
      isAuthoritative: boolean
      policySourceId: string | null
    }> = {}
    for (const item of query.items) {
      const key = availabilityItemKey(item)
      const configured = world.availability[key] ?? { state: 'in_stock', canFulfil: true }
      byItem[key] = {
        state: configured.state,
        availableQuantity: null,
        canFulfil: configured.canFulfil,
        leadTimeDays: null,
        releaseAt: null,
        isAuthoritative: false,
        policySourceId: null,
      }
    }
    return { byItem }
  },
})

const policyResolutionService = {
  async resolveMany(_em: unknown, scopes: Array<{ productId: string; variantId: string | null }>) {
    counters.policies += 1
    return scopes.map((scope) => ({
      hideWhenOutOfStock: { value: world.hideWhenOutOfStock.has(scope.productId) },
      minOrderQuantity: { value: world.policy.minOrderQuantity },
      maxOrderQuantity: { value: world.policy.maxOrderQuantity },
      quantityIncrement: { value: world.policy.quantityIncrement },
    }))
  },
}

function publicMediaRows(): Array<{ id: string; mime_type: string }> {
  const visibleCodes = new Set(
    PARTITIONS.filter((partition) => partition.isPublic && (partition.tenantId === null || partition.tenantId === TENANT_ID)).map(
      (partition) => partition.code,
    ),
  )
  return MEDIA.filter((entry) => visibleCodes.has(entry.partitionCode)).map((entry) => ({ id: entry.id, mime_type: entry.mimeType }))
}

const mediaKysely: Record<string, unknown> = {}
for (const method of ['selectFrom', 'innerJoin', 'select', 'where']) {
  mediaKysely[method] = () => mediaKysely
}
mediaKysely.execute = async () => {
  counters.media += 1
  return publicMediaRows()
}

const em = {
  fork() {
    return em
  },
  getKysely() {
    return mediaKysely
  },
}

function makeContainer(): AwilixContainer {
  const services: Record<string, unknown> = {
    em,
    queryEngine,
    policyResolutionService,
    catalogPricingService: new DefaultCatalogPricingService(null),
  }
  return {
    resolve: (name: string) => {
      const service = services[name]
      if (service === undefined) throw new Error(`[internal] not registered: ${name}`)
      return service
    },
  } as unknown as AwilixContainer
}

function makeBuyer(overrides: Partial<BuyerContext> = {}): BuyerContext {
  return {
    customerUserId: null,
    customerId: null,
    companyId: null,
    customerIds: [],
    customerGroupIds: [],
    isAuthenticated: false,
    taxMode: 'gross',
    priceKindId: REGULAR_KIND.id,
    allowPurchaseOnAccount: false,
    approvalRequiredAbove: null,
    assortmentScope: null,
    assortmentScopeHash: 'none',
    priceScopeKey: 'key',
    customerOverlayId: null,
    ...overrides,
  }
}

function makeContext(buyer: Partial<BuyerContext> = {}): StoreContext {
  return {
    store: {
      id: 'store-1',
      code: 'main',
      name: 'Main',
      slug: 'main',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en', 'pl', 'de'],
      defaultCurrencyCode: 'EUR',
      settings: ecommerceStoreSettingsSchema.parse({}),
    },
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    channel: { channelBindingId: 'binding-1', salesChannelId: 'channel-1', priceKindId: REGULAR_KIND.id, priceSortFallback: 'approximate' },
    buyer: makeBuyer(buyer),
    effectiveLocale: 'pl',
    requestedLocale: 'pl',
    currencyCode: 'EUR',
    digest: 'digest',
  }
}

function detail(
  idOrHandle: string,
  options: { buyer?: Partial<BuyerContext>; variantId?: string; locale?: string } = {},
) {
  return getStorefrontProductDetail(makeContainer(), makeContext(options.buyer), idOrHandle, {
    variantId: options.variantId,
    locale: options.locale,
    date: NOW,
  })
}

function setWorld(mainVariantCount = 2) {
  const products = baseProducts(mainVariantCount)
  const main = products[0]
  world = {
    products,
    prices: [
      priceRow({ id: 'price-main', productId: MAIN_ID, gross: '100.00' }),
      priceRow({ id: 'price-main-10', productId: MAIN_ID, gross: '90.00', minQuantity: 10 }),
      ...variantsOf(main).map((variant, index) =>
        priceRow({ id: `price-${variant.id}`, productId: MAIN_ID, variantId: variant.id, gross: `${120 - index}.00` }),
      ),
      priceRow({ id: 'price-plain', productId: PLAIN_ID, gross: '50.00' }),
      priceRow({ id: 'price-plain-10', productId: PLAIN_ID, gross: '45.00', minQuantity: 10 }),
      priceRow({ id: 'price-sibling', productId: SIBLING_ID, gross: '70.00' }),
      priceRow({ id: 'price-cousin', productId: COUSIN_ID, gross: '60.00' }),
    ],
    availability: {},
    hideWhenOutOfStock: new Set(),
    policy: { minOrderQuantity: 2, maxOrderQuantity: 50, quantityIncrement: 2 },
  }
}

beforeEach(() => {
  setWorld()
  mockedFind.mockReset()
  mockedTranslations.mockReset()
  installFind()
  installTranslations()
  resetCounters()
})

describe('getStorefrontProductDetail — enumeration oracle (R4)', () => {
  const hiddenCases: Array<[string, string]> = [
    ['outside the effective assortment', 'shoe'],
    ['inactive', 'inactive-dress'],
    ['deleted', 'deleted-dress'],
    ['of another tenant', 'foreign'],
    ['nonexistent', 'does-not-exist'],
  ]

  it.each(hiddenCases)('returns null for a product %s with exactly one scoped query', async (_label, handle) => {
    const result = await detail(handle, { buyer: { assortmentScope: RESTRICTED_SCOPE } })
    expect(result).toBeNull()
    expect(totalQueries()).toBe(1)
    expect(counters.queryEngine).toBe(1)
    const scope = buildStorefrontProductScope(makeContext({ assortmentScope: RESTRICTED_SCOPE }))
    expect(queryEngineCalls[0]).toEqual({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      withDeleted: false,
      filters: composeStorefrontProductFilters(scope, { handle: { $eq: handle } }),
      fields: ['id'],
      page: { page: 1, pageSize: 1 },
    })
  })

  it('executes the same queries for every hidden case, by handle and by UUID', async () => {
    const shapes: string[] = []
    for (const idOrHandle of ['shoe', 'inactive-dress', 'deleted-dress', 'foreign', 'nope', SHOE_ID, INACTIVE_ID, DELETED_ID, FOREIGN_ID]) {
      resetCounters()
      expect(await detail(idOrHandle, { buyer: { assortmentScope: RESTRICTED_SCOPE } })).toBeNull()
      shapes.push(JSON.stringify({ ...counters }))
    }
    expect(new Set(shapes).size).toBe(1)
  })

  it('finds the same visible product by UUID and by handle', async () => {
    const byId = await detail(MAIN_ID)
    const byHandle = await detail('summer-dress')
    expect(byId?.id).toBe(MAIN_ID)
    expect(byHandle).toEqual(byId)
  })

  it('trims the identifier and matches a non-UUID value against the handle only', async () => {
    expect(await detail(` ${MAIN_ID} `)).not.toBeNull()
    resetCounters()
    await detail('summer-dress')
    expect(queryEngineCalls[0].filters).toEqual(
      composeStorefrontProductFilters(buildStorefrontProductScope(makeContext()), { handle: { $eq: 'summer-dress' } }),
    )
  })
})

describe('getStorefrontProductDetail — payload (§5.2)', () => {
  it('sanitizes the localized description server-side (R5)', async () => {
    const result = await detail(MAIN_ID)
    expect(result?.description).toContain('<p>Lniana</p>')
    expect(result?.description).not.toMatch(/script|steal|javascript:/i)
  })

  it('sanitizes the base description when no overlay applies', async () => {
    const result = await detail(MAIN_ID, { locale: 'de' })
    expect(result?.description).toContain('<strong>linen</strong>')
    expect(result?.description).not.toMatch(/<script|onerror|alert/i)
  })

  it('returns the product fields, media, dimensions, weight and seo', async () => {
    const result = await detail(MAIN_ID)
    expect(result).toMatchObject({
      id: MAIN_ID,
      handle: 'summer-dress',
      title: 'Sukienka letnia',
      subtitle: 'Linen summer dress',
      sku: 'SD-1',
      productType: 'configurable',
      isConfigurable: true,
      hasVariants: true,
      variantCount: 2,
      defaultMediaUrl: '/media/main.jpg',
      dimensions: { length: 40, width: 30, height: 2, unit: 'cm' },
      weightValue: 0.45,
      weightUnit: 'kg',
      tags: ['Sale EN'],
      seo: { title: 'Summer Dress SEO', description: null, canonicalUrl: 'https://shop.example/summer-dress' },
      availability: { state: 'in_stock', canFulfil: true, leadTimeDays: null, releaseAt: null },
    })
    expect(result?.media).toEqual([
      { id: 'media-2', url: '/files/two.jpg', alt: null, sortOrder: 0 },
      { id: 'media-1', url: '/files/one.jpg', alt: null, sortOrder: 1 },
    ])
  })

  it('publishes only images from public partitions visible to the tenant', async () => {
    const result = await detail(MAIN_ID)
    const mediaIds = result?.media.map((entry) => entry.id) ?? []
    expect(mediaIds).not.toContain('media-private')
    expect(mediaIds).not.toContain('media-pdf')
    expect(mediaIds).not.toContain('media-foreign')
    const partitionCall = mockedFind.mock.calls.find(([, entity]) => entity === AttachmentPartition)
    expect(partitionCall?.[2]).toMatchObject({ isPublic: true, code: { $in: ['productsMedia', 'privateAttachments', 'otherTenantMedia'] } })
  })

  it('derives defaultMediaUrl from the public gallery when the default media is not public', async () => {
    const main = world.products.find((product) => product.id === MAIN_ID)
    if (!main?.extra) throw new Error('[internal] fixture lacks the main product')
    main.extra.defaultMediaId = 'media-private'
    const privateDefault = await detail(MAIN_ID)
    expect(privateDefault?.media[0]?.url).toBe('/files/one.jpg')
    expect(privateDefault?.defaultMediaUrl).toBe('/files/one.jpg')
    main.extra.defaultMediaId = null
    const noDefault = await detail(MAIN_ID)
    expect(noDefault?.defaultMediaUrl).toBe('/files/one.jpg')
  })

  it('returns a null defaultMediaUrl when the product has no public image', async () => {
    const plain = world.products.find((product) => product.id === PLAIN_ID)
    if (!plain) throw new Error('[internal] fixture lacks the plain product')
    plain.extra = { defaultMediaId: 'media-private', defaultMediaUrl: '/files/secret.jpg' }
    const result = await detail('plain')
    expect(result?.media).toEqual([])
    expect(result?.defaultMediaUrl).toBeNull()
  })

  it('shows a related card image only when its default media is a public image, in one query', async () => {
    const sibling = world.products.find((product) => product.id === SIBLING_ID)
    const cousin = world.products.find((product) => product.id === COUSIN_ID)
    if (!sibling || !cousin) throw new Error('[internal] fixture lacks the related products')
    sibling.extra = { defaultMediaId: 'media-1', defaultMediaUrl: '/media/sibling.jpg' }
    cousin.extra = { defaultMediaId: 'media-private', defaultMediaUrl: '/media/cousin.jpg' }
    const result = await detail(MAIN_ID)
    expect(Object.fromEntries(result?.relatedProducts.map((item) => [item.id, item.defaultMediaUrl]) ?? [])).toEqual({
      [SIBLING_ID]: '/media/sibling.jpg',
      [COUSIN_ID]: null,
    })
    expect(counters.media).toBe(1)
  })

  it('returns categories with ancestor ids and a root-first breadcrumb', async () => {
    const result = await detail(MAIN_ID)
    expect(result?.categories).toEqual([{ id: CAT_DRESS, name: 'Sukienki', slug: 'dresses', ancestorIds: [CAT_ROOT] }])
    expect(result?.breadcrumb).toEqual([
      { id: CAT_ROOT, name: 'Clothing', slug: 'clothing' },
      { id: CAT_DRESS, name: 'Sukienki', slug: 'dresses' },
    ])
  })

  it('keeps the full breadcrumb when the product is also assigned to the ancestor itself', async () => {
    const main = world.products.find((product) => product.id === MAIN_ID)
    if (!main) throw new Error('[internal] fixture lacks the main product')
    main.categoryIds = [CAT_DRESS, CAT_ROOT]
    const result = await detail(MAIN_ID)
    expect(result?.breadcrumb.map((entry) => entry.id)).toEqual([CAT_ROOT, CAT_DRESS])
    expect(result?.breadcrumb[0]).toEqual({ id: CAT_ROOT, name: 'Clothing', slug: 'clothing' })
  })

  it('hides a category under an inactive ancestor from categories and the breadcrumb', async () => {
    const root = CATEGORIES.find((entry) => entry.id === CAT_ROOT)
    if (!root) throw new Error('[internal] fixture lacks the root category')
    root.isActive = false
    try {
      const result = await detail(MAIN_ID)
      expect(result?.categories).toEqual([])
      expect(result?.breadcrumb).toEqual([])
    } finally {
      root.isActive = true
    }
  })

  it('returns variants with option values, default flag, per-variant price and availability', async () => {
    const variantKey = availabilityItemKey({ catalogProductId: MAIN_ID, catalogVariantId: variantId(MAIN_ID, 0) })
    world.availability[variantKey] = { state: 'out_of_stock', canFulfil: false }
    const result = await detail(MAIN_ID)
    expect(result?.variants.map((variant) => variant.id)).toEqual([variantId(MAIN_ID, 1), variantId(MAIN_ID, 0)])
    const [first, second] = result?.variants ?? []
    expect(first).toMatchObject({
      name: 'Variant 2',
      sku: 'summer-dress-2',
      isDefault: true,
      optionValues: { color: 'blue' },
      weightValue: 0.5,
      weightUnit: 'kg',
      dimensions: null,
      availability: { state: 'in_stock', canFulfil: true },
    })
    expect(first.price?.amount).toBe(119)
    expect(second).toMatchObject({ isDefault: false, optionValues: { color: 'red' }, availability: { state: 'out_of_stock', canFulfil: false } })
    expect(second.price?.amount).toBe(120)
  })

  it('returns price tiers resolved for the buyer', async () => {
    const result = await detail('plain')
    expect(result?.price?.amount).toBe(50)
    expect(result?.priceTiers.map(({ minQuantity, maxQuantity, amount }) => ({ minQuantity, maxQuantity, amount }))).toEqual([
      { minQuantity: 1, maxQuantity: 9, amount: 50 },
      { minQuantity: 10, maxQuantity: null, amount: 45 },
    ])
  })

  it('reads quantity rules from the resolved availability policy', async () => {
    expect((await detail(MAIN_ID))?.quantityRules).toEqual({ minOrderQuantity: 2, maxOrderQuantity: 50, quantityIncrement: 2 })
  })

  it('falls back to the product order quantities where the policy sets none', async () => {
    world.policy = { minOrderQuantity: null, maxOrderQuantity: null, quantityIncrement: null }
    expect((await detail(MAIN_ID))?.quantityRules).toEqual({ minOrderQuantity: 3, maxOrderQuantity: null, quantityIncrement: null })
  })

  it('preselects the requested variant, else the default variant', async () => {
    expect((await detail(MAIN_ID, { variantId: variantId(MAIN_ID, 0) }))?.selectedVariantId).toBe(variantId(MAIN_ID, 0))
    expect((await detail(MAIN_ID, { variantId: variantId(SIBLING_ID, 0) }))?.selectedVariantId).toBe(variantId(MAIN_ID, 1))
    expect((await detail(MAIN_ID))?.selectedVariantId).toBe(variantId(MAIN_ID, 1))
  })
})

describe('getStorefrontProductDetail — per-variant price tiers', () => {
  function addVariantTierRows() {
    world.prices.push(
      priceRow({ id: 'price-v0-10', productId: MAIN_ID, variantId: variantId(MAIN_ID, 0), gross: '110.00', minQuantity: 10 }),
      priceRow({ id: 'price-v1-10', productId: MAIN_ID, variantId: variantId(MAIN_ID, 1), gross: '105.00', minQuantity: 10 }),
    )
  }

  function tierSummary(tiers: Array<{ minQuantity: number; maxQuantity: number | null; amount: number }> | undefined) {
    return (tiers ?? []).map(({ minQuantity, maxQuantity, amount }) => ({ minQuantity, maxQuantity, amount }))
  }

  it('returns the tiers of the default variant when variants carry their own prices', async () => {
    addVariantTierRows()
    const result = await detail(MAIN_ID)
    expect(result?.selectedVariantId).toBe(variantId(MAIN_ID, 1))
    expect(tierSummary(result?.priceTiers)).toEqual([
      { minQuantity: 1, maxQuantity: 9, amount: 119 },
      { minQuantity: 10, maxQuantity: null, amount: 105 },
    ])
  })

  it('switches the top-level tiers with the requested variant and exposes tiers per variant', async () => {
    addVariantTierRows()
    const result = await detail(MAIN_ID, { variantId: variantId(MAIN_ID, 0) })
    expect(result?.selectedVariantId).toBe(variantId(MAIN_ID, 0))
    expect(tierSummary(result?.priceTiers)).toEqual([
      { minQuantity: 1, maxQuantity: 9, amount: 120 },
      { minQuantity: 10, maxQuantity: null, amount: 110 },
    ])
    const byId = new Map(result?.variants.map((variant) => [variant.id, tierSummary(variant.priceTiers)]))
    expect(byId.get(variantId(MAIN_ID, 0))).toEqual(tierSummary(result?.priceTiers))
    expect(byId.get(variantId(MAIN_ID, 1))).toEqual([
      { minQuantity: 1, maxQuantity: 9, amount: 119 },
      { minQuantity: 10, maxQuantity: null, amount: 105 },
    ])
  })

  it('falls back to product-level tier rows for a variant without its own prices', async () => {
    const result = await detail('plain', { variantId: variantId(PLAIN_ID, 0) })
    expect(result?.selectedVariantId).toBe(variantId(PLAIN_ID, 0))
    expect(tierSummary(result?.priceTiers)).toEqual([
      { minQuantity: 1, maxQuantity: 9, amount: 50 },
      { minQuantity: 10, maxQuantity: null, amount: 45 },
    ])
  })

  it('keeps the product tiers for a product without variants', async () => {
    setWorld(0)
    const result = await detail('plain')
    expect(result?.variants).toEqual([])
    expect(result?.selectedVariantId).toBeNull()
    expect(tierSummary(result?.priceTiers)).toEqual([
      { minQuantity: 1, maxQuantity: 9, amount: 50 },
      { minQuantity: 10, maxQuantity: null, amount: 45 },
    ])
  })

  it('resolves variant tiers without extra queries', async () => {
    resetCounters()
    await detail(MAIN_ID)
    const baseline = totalQueries()
    addVariantTierRows()
    resetCounters()
    await detail(MAIN_ID, { variantId: variantId(MAIN_ID, 0) })
    expect(totalQueries()).toBe(baseline)
    expect(totalQueries()).toBeLessThanOrEqual(11)
  })
})

describe('getStorefrontProductDetail — overlays (§7)', () => {
  it('overlays the option schema name, option labels and choice labels with base fallback', async () => {
    const result = await detail(MAIN_ID)
    expect(result?.optionSchema?.name).toBe('Opcje sukienki')
    expect(result?.optionSchema?.options[0].label).toBe('Kolor')
    expect(result?.optionSchema?.options[0].choices).toEqual([
      { code: 'red', label: 'Czerwony' },
      { code: 'blue', label: 'Blue' },
    ])
  })

  it('reads option and choice labels from the catalog translation field keys', () => {
    expect(optionLabelTranslationField('color')).toBe('options.color.label')
    expect(optionChoiceLabelTranslationField('color', 'red')).toBe('options.color.choices.red.label')
    expect(optionLabelTranslationField).toBe(catalogOptionLabelField)
    expect(optionChoiceLabelTranslationField).toBe(catalogChoiceLabelField)
  })

  it('falls back from the requested locale to the store default and then to the base field', async () => {
    const polish = await detail(MAIN_ID)
    expect(polish?.title).toBe('Sukienka letnia')
    expect(polish?.subtitle).toBe('Linen summer dress')
    expect(polish?.variants[0].name).toBe('Variant 2')
    const german = await detail(MAIN_ID, { locale: 'de' })
    expect(german?.title).toBe('Summer Dress EN')
    expect(german?.categories[0].name).toBe('Dresses')
    expect(german?.optionSchema?.options[0].label).toBe('Color')
  })

  it('ignores an unsupported locale override', async () => {
    expect((await detail(MAIN_ID, { locale: 'fr' }))?.title).toBe('Sukienka letnia')
  })

  it('degrades to base fields when the translation overlay fails', async () => {
    mockedTranslations.mockRejectedValueOnce(new Error('boom'))
    const result = await detail(MAIN_ID)
    expect(result?.title).toBe('Summer Dress')
    expect(result?.categories[0].name).toBe('Dresses')
  })
})

describe('getStorefrontProductDetail — related products', () => {
  it('lists same-category products within the scope, never a restricted one', async () => {
    const result = await detail(MAIN_ID, { buyer: { assortmentScope: RESTRICTED_SCOPE } })
    expect(result?.relatedProducts.map((item) => item.id)).toEqual([SIBLING_ID])
    expect(result?.relatedProducts[0]).toMatchObject({
      title: 'Siostrzana',
      categories: [{ id: CAT_DRESS, name: 'Sukienki', slug: 'dresses' }],
      price: { amount: 70 },
    })
  })

  it('includes every visible same-category product for an unrestricted buyer, newest first', async () => {
    const result = await detail(MAIN_ID)
    expect(result?.relatedProducts.map((item) => item.id)).toEqual([COUSIN_ID, SIBLING_ID])
  })

  it('hides out-of-stock related products whose policy says so', async () => {
    world.hideWhenOutOfStock.add(COUSIN_ID)
    world.availability[availabilityItemKey({ catalogProductId: COUSIN_ID, catalogVariantId: null })] = {
      state: 'out_of_stock',
      canFulfil: false,
    }
    const result = await detail(MAIN_ID)
    expect(result?.relatedProducts.map((item) => item.id)).toEqual([SIBLING_ID])
  })

  it('caps the related products and asks the engine for at most the cap', async () => {
    await detail(MAIN_ID)
    expect(queryEngineCalls[1].page).toEqual({ page: 1, pageSize: STOREFRONT_RELATED_PRODUCTS_LIMIT })
  })

  it('has no related products and no breadcrumb for an uncategorized product', async () => {
    const result = await detail('plain')
    expect(result?.relatedProducts).toEqual([])
    expect(result?.breadcrumb).toEqual([])
    expect(result?.categories).toEqual([])
    expect(counters.queryEngine).toBe(1)
  })
})

describe('getStorefrontProductDetail — query budget (§10)', () => {
  it('stays within 7 queries for a product with 20 variants', async () => {
    setWorld(20)
    resetCounters()
    const result = await detail('plain')
    expect(result?.variants).toHaveLength(20)
    expect(totalQueries()).toBeLessThanOrEqual(7)
  })

  it('does not grow with the variant count', async () => {
    setWorld(1)
    resetCounters()
    await detail('plain')
    const plainSingle = totalQueries()
    await detail(MAIN_ID)
    const categorizedSingle = totalQueries() - plainSingle
    setWorld(20)
    resetCounters()
    await detail('plain')
    expect(totalQueries()).toBe(plainSingle)
    resetCounters()
    await detail(MAIN_ID)
    expect(totalQueries()).toBe(categorizedSingle)
  })

  it('adds a bounded number of queries for breadcrumb ancestors and related products', async () => {
    setWorld(20)
    resetCounters()
    const result = await detail(MAIN_ID)
    expect(result?.relatedProducts.length).toBeGreaterThan(0)
    expect(totalQueries()).toBeLessThanOrEqual(11)
  })
})
