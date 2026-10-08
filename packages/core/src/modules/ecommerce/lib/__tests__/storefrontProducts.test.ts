import type { AwilixContainer } from 'awilix'
import { createMemoryStrategy, type CacheStrategy } from '@open-mercato/cache'
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
import {
  CatalogOptionSchemaTemplate,
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
  CatalogProductTag,
  CatalogProductTagAssignment,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { OmnibusBlock } from '@open-mercato/core/modules/catalog/lib/omnibusTypes'
import { DefaultCatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { batchLoadTranslationsMany } from '@open-mercato/core/modules/translations/lib/batch'
import { ecommerceStoreSettingsSchema, type EcommercePriceSortFallback } from '../../data/validators'
import { parseStorefrontProductListQuery } from '../storefrontQuery'
import { isCategoryInAssortment, listStorefrontProducts } from '../storefrontProducts'
import type { BuyerContext, StoreContext } from '../types'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/core/modules/translations/lib/batch', () => ({
  batchLoadTranslations: jest.fn(),
  batchLoadTranslationsMany: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  loadDictionary: jest.fn(async () => ({
    'catalog.products.types.simple': 'Prosty',
    'catalog.products.types.configurable': 'Konfigurowalny',
  })),
}))

jest.mock('@open-mercato/core/modules/catalog/lib/omnibusPresentedEntry', () => ({
  ...jest.requireActual('@open-mercato/core/modules/catalog/lib/omnibusPresentedEntry'),
  resolveOmnibusPresentedEntries: jest.fn(async (_em: unknown, prices: Array<{ id: string }>) => {
    const entries = new Map<string, { priceId: string; changeType: 'update'; recordedAt: Date }>()
    for (const price of prices) {
      entries.set(price.id, { priceId: price.id, changeType: 'update', recordedAt: new Date('2026-09-01T00:00:00Z') })
    }
    return entries
  }),
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
const TAG_NEW = '0b8f3f0e-1d2a-4c5b-8e6f-000000000012'
const TEMPLATE_SHOE = '0b8f3f0e-1d2a-4c5b-8e6f-000000000021'

type PriceKindFixture = { id: string; code: string; isPromotion: boolean; displayMode: string }

const REGULAR_KIND: PriceKindFixture = { id: 'pk-regular', code: 'regular', isPromotion: false, displayMode: 'including-tax' }
const PROMO_KIND: PriceKindFixture = { id: 'pk-promo', code: 'promotion', isPromotion: true, displayMode: 'including-tax' }

type CategoryFixture = {
  id: string
  name: string
  slug: string
  depth: number
  parentId: string | null
  ancestorIds: string[]
  descendantIds: string[]
  isActive: boolean
  deletedAt: Date | null
  tenantId: string
  organizationId: string
}

function category(id: string, slug: string, name: string, ancestorIds: string[], descendantIds: string[]): CategoryFixture {
  return {
    id,
    name,
    slug,
    depth: ancestorIds.length,
    parentId: ancestorIds[ancestorIds.length - 1] ?? null,
    ancestorIds,
    descendantIds,
    isActive: true,
    deletedAt: null,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
  }
}

const CATEGORIES: CategoryFixture[] = [
  category(CAT_ROOT, 'clothing', 'Clothing', [], [CAT_DRESS]),
  category(CAT_DRESS, 'dresses', 'Dresses', [CAT_ROOT], []),
  category(CAT_SHOES, 'shoes', 'Shoes', [], []),
]

const TAGS = [
  { id: TAG_SALE, slug: 'sale', label: 'Sale', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
  { id: TAG_NEW, slug: 'new', label: 'New', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
]

type ProductFixture = {
  id: string
  title: string
  subtitle: string | null
  sku: string
  createdAt: string
  categoryIds: string[]
  tagIds: string[]
  isActive?: boolean
  isConfigurable?: boolean
  productType?: string
  templateId?: string
}

const PRODUCTS: ProductFixture[] = [
  { id: 'p-alpha', title: 'Alpha Dress', subtitle: 'Base alpha subtitle', sku: 'A-1', createdAt: '2026-01-01', categoryIds: [CAT_DRESS], tagIds: [TAG_SALE] },
  { id: 'p-bravo', title: 'Bravo Dress', subtitle: null, sku: 'B-1', createdAt: '2026-02-01', categoryIds: [CAT_DRESS], tagIds: [] },
  { id: 'p-charlie', title: 'Charlie Shoe', subtitle: null, sku: 'C-1', createdAt: '2026-03-01', categoryIds: [CAT_SHOES], tagIds: [TAG_NEW] },
  {
    id: 'p-delta',
    title: 'Delta Shoe',
    subtitle: null,
    sku: 'D-1',
    createdAt: '2026-04-01',
    categoryIds: [CAT_SHOES],
    tagIds: [],
    isConfigurable: true,
    productType: 'configurable',
    templateId: TEMPLATE_SHOE,
  },
  { id: 'p-echo', title: 'Echo Hidden', subtitle: null, sku: 'E-1', createdAt: '2026-05-01', categoryIds: [CAT_DRESS], tagIds: [], isActive: false },
]

const VARIANTS = [
  { id: 'v-d1', product: { id: 'p-delta' }, optionValues: { color: 'red', size: 'm' } },
  { id: 'v-d2', product: { id: 'p-delta' }, optionValues: { color: 'blue', size: 'l' } },
].map((variant) => ({ ...variant, isActive: true, deletedAt: null, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }))

const TEMPLATES = [
  {
    id: TEMPLATE_SHOE,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    deletedAt: null,
    isActive: true,
    schema: {
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
        {
          code: 'size',
          label: 'Size',
          inputType: 'select',
          choices: [
            { code: 'm', label: 'M' },
            { code: 'l', label: 'L' },
          ],
        },
      ],
    },
  },
]

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
    tenant_id: TENANT_ID,
    organization_id: ORGANIZATION_ID,
    deleted_at: null,
    is_active: product.isActive ?? true,
    title: product.title,
    subtitle: product.subtitle,
    handle: product.id.replace('p-', ''),
    sku: product.sku,
    product_type: product.productType ?? 'simple',
    is_configurable: product.isConfigurable ?? false,
    default_media_url: `/media/${product.id}.jpg`,
    option_schema_id: product.templateId ?? null,
    created_at: new Date(`${product.createdAt}T00:00:00Z`),
    scope_keys: Array.from(scopeKeys),
  }
}

type PriceInput = {
  id: string
  productId?: string
  variantId?: string
  gross: string
  kind?: PriceKindFixture
  customerGroupId?: string | null
}

function priceRow(input: PriceInput) {
  const kind = input.kind ?? REGULAR_KIND
  const productId = input.productId ?? VARIANTS.find((variant) => variant.id === input.variantId)?.product.id
  return {
    id: input.id,
    product: input.variantId ? null : { id: input.productId },
    variant: input.variantId ? { id: input.variantId, product: { id: productId } } : null,
    offer: null,
    priceKind: { ...kind },
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    currencyCode: 'EUR',
    kind: kind.code,
    minQuantity: 1,
    maxQuantity: null,
    unitPriceNet: null,
    unitPriceGross: input.gross,
    taxRate: null,
    taxAmount: null,
    channelId: null,
    userId: null,
    userGroupId: null,
    customerId: null,
    customerGroupId: input.customerGroupId ?? null,
    metadata: null,
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
  }
}

const BASE_PRICES = [
  priceRow({ id: 'price-alpha', productId: 'p-alpha', gross: '50.00' }),
  priceRow({ id: 'price-bravo', productId: 'p-bravo', gross: '30.00' }),
  priceRow({ id: 'price-charlie', productId: 'p-charlie', gross: '80.00' }),
  priceRow({ id: 'price-d1', variantId: 'v-d1', gross: '20.00' }),
  priceRow({ id: 'price-d2', variantId: 'v-d2', gross: '20.00' }),
  priceRow({ id: 'price-echo', productId: 'p-echo', gross: '1.00' }),
]

const VIP_ALPHA_PRICE = priceRow({ id: 'price-alpha-vip', productId: 'p-alpha', gross: '15.00', customerGroupId: 'group-vip' })

const TRANSLATIONS: Record<string, Record<string, Record<string, Record<string, unknown>>>> = {
  'catalog:catalog_product': {
    'p-alpha': { pl: { title: 'Alfa Sukienka', subtitle: '' }, en: { subtitle: 'Summer dress' } },
    'p-bravo': { de: { title: 'Bravo DE' } },
    'p-charlie': { pl: { title: '   ' }, en: { title: '' } },
  },
  'catalog:catalog_product_category': {
    [CAT_DRESS]: { pl: { name: 'Sukienki' } },
  },
  'catalog:catalog_product_tag': {
    [TAG_SALE]: { en: { label: 'Sale EN' } },
  },
  'catalog:catalog_option_schema_template': {
    [TEMPLATE_SHOE]: { pl: { 'options.color.label': 'Kolor', 'options.color.choices.red.label': 'Czerwony' } },
  },
}

type World = {
  prices: ReturnType<typeof priceRow>[]
  availability: Record<string, { state: AvailabilityState; canFulfil: boolean }>
  hideWhenOutOfStock: Set<string>
  omnibus: boolean
}

let world: World

const counters = { queryEngine: 0, find: 0, assignments: 0, translations: 0, availability: 0, policies: 0 }
const queryEngineCalls: QueryOptions[] = []
const returnedIds: string[] = []

function resetCounters() {
  counters.queryEngine = 0
  counters.find = 0
  counters.assignments = 0
  counters.translations = 0
  counters.availability = 0
  counters.policies = 0
  queryEngineCalls.length = 0
  returnedIds.length = 0
}

function totalQueries(): number {
  return (
    counters.queryEngine +
    counters.find +
    counters.assignments +
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
    case 'ne':
      return actual !== filter.value
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

function compareValues(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime()
  return String(left ?? '').localeCompare(String(right ?? ''))
}

const queryEngine = {
  async query(_entity: string, options: QueryOptions = {}) {
    counters.queryEngine += 1
    queryEngineCalls.push(options)
    const rows = PRODUCTS.map(indexRow).filter((row) => {
      if (row.tenant_id !== options.tenantId || row.organization_id !== options.organizationId) return false
      return rowMatches(row, (options.filters ?? {}) as Where)
    })
    const sorts = options.sort ?? []
    rows.sort((left, right) => {
      for (const sort of sorts) {
        const diff = compareValues(left[sort.field], right[sort.field])
        if (diff !== 0) return sort.dir === 'desc' ? -diff : diff
      }
      return left.id.localeCompare(right.id)
    })
    const page = options.page?.page ?? 1
    const pageSize = options.page?.pageSize ?? 20
    const items = rows.slice((page - 1) * pageSize, page * pageSize).map((row) => {
      const projected: Record<string, unknown> = {}
      for (const field of options.fields ?? Object.keys(row)) projected[field] = row[field]
      return projected
    })
    returnedIds.push(...items.map((item) => String(item.id)))
    return { items, total: rows.length, page, pageSize }
  },
}

let searchTerm = ''

function installFind() {
  mockedFind.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    counters.find += 1
    if (entity === CatalogProductCategory) {
      return CATEGORIES.filter((entry) => matchesWhere(entry as unknown as Record<string, unknown>, where))
    }
    if (entity === CatalogProductTag) {
      return TAGS.filter((entry) => matchesWhere(entry as unknown as Record<string, unknown>, where))
    }
    if (entity === CatalogProductVariant) {
      return VARIANTS.filter((entry) => matchesWhere(entry as unknown as Record<string, unknown>, where))
    }
    if (entity === CatalogProductCategoryAssignment) {
      const assignments = PRODUCTS.flatMap((product) =>
        product.categoryIds.map((categoryId, position) => ({
          id: `${product.id}:${categoryId}`,
          product: { id: product.id },
          category: CATEGORIES.find((entry) => entry.id === categoryId),
          position,
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
        })),
      )
      return assignments.filter((entry) => matchesWhere(entry as unknown as Record<string, unknown>, where))
    }
    if (entity === CatalogProductTagAssignment) {
      const assignments = PRODUCTS.flatMap((product) =>
        product.tagIds.map((tagId) => ({
          id: `${product.id}:${tagId}`,
          product: { id: product.id },
          tag: TAGS.find((entry) => entry.id === tagId),
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
        })),
      )
      return assignments.filter((entry) => matchesWhere(entry as unknown as Record<string, unknown>, where))
    }
    if (entity === CatalogOptionSchemaTemplate) {
      return TEMPLATES.filter((entry) => matchesWhere(entry as unknown as Record<string, unknown>, where))
    }
    if (entity === CatalogProductPrice) {
      return world.prices.filter((row) => matchesWhere(row as unknown as Record<string, unknown>, where))
    }
    if (entity === CatalogProduct) {
      const needle = searchTerm.toLowerCase()
      return PRODUCTS.filter((product) => `${product.title} ${product.sku}`.toLowerCase().includes(needle)).map(
        (product) => ({ id: product.id }),
      )
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
        const map = result.get(request.entityType) ?? new Map<string, Record<string, Record<string, unknown>>>()
        for (const id of request.entityIds) if (source[id]) map.set(id, source[id])
        result.set(request.entityType, map)
      }
      return result
    },
  )
}

type AssignmentRowFixture = { product_id: string; kind: string; ref_id: string; slug: string | null; label: string | null }

function assignmentRows(): AssignmentRowFixture[] {
  return PRODUCTS.flatMap((product) => [
    ...product.categoryIds.map((categoryId) => ({
      product_id: product.id,
      kind: 'category',
      ref_id: categoryId,
      slug: null,
      label: null,
    })),
    ...product.tagIds.map((tagId) => {
      const tag = TAGS.find((entry) => entry.id === tagId)
      return { product_id: product.id, kind: 'tag', ref_id: tagId, slug: tag?.slug ?? null, label: tag?.label ?? null }
    }),
  ])
}

const kyselyBuilder: Record<string, unknown> = {}
for (const method of ['selectFrom', 'innerJoin', 'select', 'where', 'unionAll']) {
  kyselyBuilder[method] = () => kyselyBuilder
}
kyselyBuilder.execute = async () => {
  counters.assignments += 1
  return assignmentRows()
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
      const configured = world.availability[item.catalogProductId] ?? { state: 'in_stock', canFulfil: true }
      byItem[availabilityItemKey(item)] = {
        state: configured.state,
        availableQuantity: null,
        canFulfil: configured.canFulfil,
        leadTimeDays: configured.state === 'backorder' ? 7 : null,
        releaseAt: null,
        isAuthoritative: false,
        policySourceId: null,
      }
    }
    return { byItem }
  },
})

const policyResolutionService = {
  async resolveMany(_em: unknown, scopes: Array<{ productId: string; storeId: string | null }>) {
    counters.policies += 1
    return scopes.map((scope) => ({ hideWhenOutOfStock: { value: world.hideWhenOutOfStock.has(scope.productId) } }))
  },
}

function omnibusBlock(): OmnibusBlock {
  return {
    presentedPriceKindId: REGULAR_KIND.id,
    lookbackDays: 30,
    minimizationAxis: 'gross',
    promotionAnchorAt: null,
    windowStart: '2026-09-05T12:00:00.000Z',
    windowEnd: '2026-10-05T12:00:00.000Z',
    coverageStartAt: null,
    lowestPriceNet: null,
    lowestPriceGross: '28.0000',
    previousPriceNet: null,
    previousPriceGross: null,
    currencyCode: 'EUR',
    applicable: true,
    applicabilityReason: 'announced_promotion',
  }
}

const em = {
  fork() {
    return em
  },
  getKysely() {
    return kyselyBuilder
  },
}

function makeContainer(cache?: CacheStrategy): AwilixContainer {
  const services: Record<string, unknown> = {
    em,
    queryEngine,
    policyResolutionService,
    catalogPricingService: new DefaultCatalogPricingService(null),
    ...(cache ? { cache } : {}),
  }
  return {
    resolve: (name: string) => {
      if (name === 'catalogOmnibusService' && world.omnibus) {
        return { resolveOmnibusBlocks: async (_em: unknown, requests: unknown[]) => requests.map(() => omnibusBlock()) }
      }
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

function makeContext(
  buyer: Partial<BuyerContext> = {},
  overrides: { priceSortFallback?: EcommercePriceSortFallback } = {},
): StoreContext {
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
    channel: {
      channelBindingId: 'binding-1',
      salesChannelId: 'channel-1',
      priceKindId: REGULAR_KIND.id,
      priceSortFallback: overrides.priceSortFallback ?? 'approximate',
    },
    buyer: makeBuyer(buyer),
    effectiveLocale: 'pl',
    requestedLocale: 'pl',
    currencyCode: 'EUR',
    digest: 'digest',
  }
}

async function list(
  queryString: string,
  options: {
    buyer?: Partial<BuyerContext>
    fallback?: EcommercePriceSortFallback
    cap?: number
    cache?: CacheStrategy
  } = {},
) {
  return listStorefrontProducts(
    makeContainer(options.cache),
    makeContext(options.buyer, { priceSortFallback: options.fallback }),
    parseStorefrontProductListQuery(new URLSearchParams(queryString)),
    { priceSortCap: options.cap, date: NOW },
  )
}

function ids(response: { items: Array<{ id: string }> }): string[] {
  return response.items.map((item) => item.id)
}

beforeEach(() => {
  world = { prices: [...BASE_PRICES], availability: {}, hideWhenOutOfStock: new Set(), omnibus: false }
  searchTerm = ''
  mockedFind.mockReset()
  mockedTranslations.mockReset()
  installFind()
  installTranslations()
  resetCounters()
})

describe('listStorefrontProducts — listing payload', () => {
  it('lists the assortment in the default featured order with the full item shape', async () => {
    const response = await list('')
    expect(ids(response)).toEqual(['p-delta', 'p-charlie', 'p-bravo', 'p-alpha'])
    expect(response).toMatchObject({
      total: 4,
      page: 1,
      pageSize: 24,
      totalPages: 1,
      effectiveLocale: 'pl',
      requestedLocale: 'pl',
      currencyCode: 'EUR',
      taxMode: 'gross',
      appliedFilters: {},
      appliedSort: 'featured',
      availableSorts: ['price_asc', 'price_desc', 'title_asc', 'title_desc', 'newest', 'featured'],
      priceSort: { cap: 5000, fallback: 'approximate', capExceeded: false },
      sortApproximate: false,
      sortUnavailable: false,
    })
    expect(response.facets).toEqual({
      categories: [
        { id: CAT_ROOT, name: 'Clothing', slug: 'clothing', depth: 0, parentId: null, count: 2 },
        { id: CAT_SHOES, name: 'Shoes', slug: 'shoes', depth: 0, parentId: null, count: 2 },
        { id: CAT_DRESS, name: 'Sukienki', slug: 'dresses', depth: 1, parentId: CAT_ROOT, count: 2 },
      ],
      tags: [
        { slug: 'new', label: 'New', count: 1 },
        { slug: 'sale', label: 'Sale EN', count: 1 },
      ],
      priceRange: { min: 20, max: 80, currencyCode: 'EUR' },
      options: [
        {
          code: 'color',
          label: 'Kolor',
          values: [
            { code: 'red', label: 'Czerwony', count: 1 },
            { code: 'blue', label: 'Blue', count: 1 },
          ],
        },
        {
          code: 'size',
          label: 'Size',
          values: [
            { code: 'm', label: 'M', count: 1 },
            { code: 'l', label: 'L', count: 1 },
          ],
        },
      ],
      productTypes: [
        { type: 'simple', label: 'Prosty', count: 3 },
        { type: 'configurable', label: 'Konfigurowalny', count: 1 },
      ],
      availability: [{ state: 'in_stock', count: 4 }],
      availabilityScope: 'page',
      total: 4,
    })
    const alpha = response.items.find((item) => item.id === 'p-alpha')
    expect(alpha).toMatchObject({
      handle: 'alpha',
      defaultMediaUrl: '/media/p-alpha.jpg',
      productType: 'simple',
      isConfigurable: false,
      hasVariants: false,
      variantCount: 0,
      categories: [{ id: CAT_DRESS, name: 'Sukienki', slug: 'dresses' }],
      tags: ['Sale EN'],
      priceRange: null,
      availability: { state: 'in_stock', canFulfil: true, leadTimeDays: null, releaseAt: null },
      badges: [],
    })
    expect(alpha?.price).toMatchObject({ amount: 50, currencyCode: 'EUR', displayMode: 'gross', isPromotion: false })
    const delta = response.items.find((item) => item.id === 'p-delta')
    expect(delta).toMatchObject({
      productType: 'configurable',
      isConfigurable: true,
      hasVariants: true,
      variantCount: 2,
      categories: [{ id: CAT_SHOES, name: 'Shoes', slug: 'shoes' }],
    })
    expect(delta?.priceRange).toMatchObject({ min: 20, max: 20 })
  })

  it('hides a category under an inactive ancestor from product cards and the category filter', async () => {
    const root = CATEGORIES.find((entry) => entry.id === CAT_ROOT)
    if (!root) throw new Error('[internal] fixture lacks the root category')
    root.isActive = false
    try {
      const response = await list('sort=title_asc')
      expect(response.items.find((item) => item.id === 'p-alpha')?.categories).toEqual([])
      expect(response.items.find((item) => item.id === 'p-charlie')?.categories).toEqual([
        { id: CAT_SHOES, name: 'Shoes', slug: 'shoes' },
      ])
      const filtered = await list(`categoryId=${CAT_DRESS}`)
      expect(filtered.appliedFilters.category).toBeUndefined()
    } finally {
      root.isActive = true
    }
  })

  it('applies the overlay fallback chain requested → store default → base and never yields an empty string', async () => {
    const response = await list('sort=title_asc')
    const byId = new Map(response.items.map((item) => [item.id, item]))
    expect(byId.get('p-alpha')).toMatchObject({ title: 'Alfa Sukienka', subtitle: 'Summer dress' })
    expect(byId.get('p-bravo')).toMatchObject({ title: 'Bravo Dress', subtitle: null })
    expect(byId.get('p-charlie')?.title).toBe('Charlie Shoe')
    expect(mockedTranslations).toHaveBeenCalledTimes(1)
  })

  it('degrades to base fields when the translation overlay fails', async () => {
    mockedTranslations.mockRejectedValue(new Error('relation "entity_translations" does not exist'))
    const response = await list('sort=title_asc')
    expect(response.items.find((item) => item.id === 'p-alpha')).toMatchObject({
      title: 'Alpha Dress',
      subtitle: 'Base alpha subtitle',
      categories: [{ id: CAT_DRESS, name: 'Dresses', slug: 'dresses' }],
      tags: ['Sale'],
    })
  })

  it('marks a presented promotion with the sale badge only when Omnibus supplies the lowest prior price', async () => {
    world.prices.push(priceRow({ id: 'price-bravo-promo', productId: 'p-bravo', gross: '25.00', kind: PROMO_KIND }))
    const withoutOmnibus = await list('sort=title_asc')
    const bravoPlain = withoutOmnibus.items.find((item) => item.id === 'p-bravo')
    expect(bravoPlain?.price).toMatchObject({ amount: 25, isPromotion: false })
    expect(bravoPlain?.badges).toEqual([])

    world.omnibus = true
    const withOmnibus = await list('sort=title_asc')
    const bravo = withOmnibus.items.find((item) => item.id === 'p-bravo')
    expect(bravo?.price).toMatchObject({ amount: 25, isPromotion: true, originalAmount: 30, lowestPriorAmount: 28 })
    expect(bravo?.badges).toEqual(['sale'])
  })
})

describe('listStorefrontProducts — assortment scope', () => {
  const restricted: EffectiveAssortmentScope = [{ categoryIds: [CAT_ROOT] }]

  it.each([
    ['', undefined],
    ['sort=price_asc', undefined],
    ['sort=title_desc&productType=simple', undefined],
    ['categorySlug=shoes', undefined],
    ['priceMin=1&priceMax=100', undefined],
    ['sort=price_desc', 1],
    ['search=e', undefined],
  ])('never returns a product outside the scope for "%s"', async (queryString, cap) => {
    searchTerm = 'e'
    const response = await list(queryString, { buyer: { assortmentScope: restricted }, cap })
    expect(ids(response).every((id) => id === 'p-alpha' || id === 'p-bravo')).toBe(true)
    expect(returnedIds.every((id) => id === 'p-alpha' || id === 'p-bravo')).toBe(true)
    for (const call of queryEngineCalls) {
      expect(call.tenantId).toBe(TENANT_ID)
      expect(call.organizationId).toBe(ORGANIZATION_ID)
    }
  })

  it('drops an out-of-assortment category from appliedFilters instead of applying it', async () => {
    const response = await list('categorySlug=shoes', { buyer: { assortmentScope: restricted } })
    expect(response.appliedFilters.category).toBeUndefined()
    expect(ids(response).sort()).toEqual(['p-alpha', 'p-bravo'])
  })

  it('never lists an inactive product, even when a filter targets it', async () => {
    const response = await list('categorySlug=dresses&sort=price_asc')
    expect(ids(response)).toEqual(['p-bravo', 'p-alpha'])
  })

  it('returns nothing for a deny-all scope', async () => {
    const response = await list('', { buyer: { assortmentScope: [] } })
    expect(response.items).toEqual([])
    expect(response.total).toBe(0)
    expect(response.totalPages).toBe(0)
  })

  it('decides category visibility over ancestors, descendants and exclusions', () => {
    const dress = { id: CAT_DRESS, ancestorIds: [CAT_ROOT], descendantIds: [] }
    const root = { id: CAT_ROOT, ancestorIds: [], descendantIds: [CAT_DRESS] }
    expect(isCategoryInAssortment(dress, null)).toBe(true)
    expect(isCategoryInAssortment(dress, [])).toBe(false)
    expect(isCategoryInAssortment(dress, [{ categoryIds: [CAT_ROOT] }])).toBe(true)
    expect(isCategoryInAssortment(root, [{ categoryIds: [CAT_DRESS] }])).toBe(true)
    expect(isCategoryInAssortment(dress, [{ excludeCategoryIds: [CAT_ROOT] }])).toBe(false)
    expect(isCategoryInAssortment(dress, [{ tagIds: [TAG_SALE] }])).toBe(true)
    expect(isCategoryInAssortment(dress, [{ categoryIds: [CAT_SHOES] }])).toBe(false)
    expect(isCategoryInAssortment(dress, [{ categoryIds: [CAT_ROOT], allOf: [{ categoryIds: [CAT_SHOES] }] }])).toBe(false)
  })
})

describe('listStorefrontProducts — filters', () => {
  it('filters by category including descendants and echoes the interpretation', async () => {
    const response = await list('categorySlug=clothing&sort=title_asc')
    expect(ids(response)).toEqual(['p-alpha', 'p-bravo'])
    expect(response.appliedFilters.category).toEqual({ id: CAT_ROOT, slug: 'clothing', includesDescendants: true })
  })

  it('leaves an unknown category out of appliedFilters', async () => {
    const response = await list('categorySlug=missing')
    expect(response.appliedFilters.category).toBeUndefined()
    expect(response.total).toBe(4)
  })

  it('filters by known tag slugs and echoes only the ones it applied', async () => {
    const response = await list('tagSlugs=sale,unknown')
    expect(ids(response)).toEqual(['p-alpha'])
    expect(response.appliedFilters.tagSlugs).toEqual(['sale'])
  })

  it('filters by variant option values', async () => {
    const response = await list('options[color]=red')
    expect(ids(response)).toEqual(['p-delta'])
    expect(response.appliedFilters.options).toEqual({ color: ['red'] })
    const none = await list('options[color]=green')
    expect(none.items).toEqual([])
  })

  it('filters by product type', async () => {
    const response = await list('productType=configurable')
    expect(ids(response)).toEqual(['p-delta'])
    expect(response.appliedFilters.productType).toBe('configurable')
  })

  it('filters by the buyer price, not the list price', async () => {
    const anonymous = await list('priceMin=10&priceMax=20&sort=price_asc')
    expect(ids(anonymous)).toEqual(['p-delta'])
    expect(anonymous.appliedFilters.price).toEqual({ min: 10, max: 20, approximate: false })
    expect(anonymous.total).toBe(1)

    world.prices.push(VIP_ALPHA_PRICE)
    const vip = await list('priceMin=10&priceMax=20&sort=price_asc', { buyer: { customerGroupIds: ['group-vip'] } })
    expect(ids(vip)).toEqual(['p-alpha', 'p-delta'])
    expect(vip.items[0].price?.amount).toBe(15)
  })

  it('ranks a search by relevance by default and offers the relevance sort', async () => {
    searchTerm = 'dress'
    const response = await list('search=Dress')
    expect(response.appliedSort).toBe('relevance')
    expect(response.availableSorts[0]).toBe('relevance')
    expect(response.appliedFilters.search).toBe('Dress')
    expect(ids(response)).toEqual(['p-alpha', 'p-bravo'])
  })

  it('falls back to the default sort when relevance is requested without a search', async () => {
    const response = await list('sort=relevance')
    expect(response.appliedSort).toBe('featured')
    expect(response.availableSorts).not.toContain('relevance')
  })
})

describe('listStorefrontProducts — sorting', () => {
  it.each([
    ['title_asc', ['p-alpha', 'p-bravo', 'p-charlie', 'p-delta']],
    ['title_desc', ['p-delta', 'p-charlie', 'p-bravo', 'p-alpha']],
    ['newest', ['p-delta', 'p-charlie', 'p-bravo', 'p-alpha']],
    ['price_asc', ['p-delta', 'p-bravo', 'p-alpha', 'p-charlie']],
    ['price_desc', ['p-charlie', 'p-alpha', 'p-bravo', 'p-delta']],
  ])('sorts by %s', async (sort, expected) => {
    const response = await list(`sort=${sort}`)
    expect(ids(response)).toEqual(expected)
    expect(response.appliedSort).toBe(sort)
    expect(response.sortApproximate).toBe(false)
  })

  it('sorts by the buyer price within the cap and paginates after sorting', async () => {
    world.prices.push(VIP_ALPHA_PRICE)
    const firstPage = await list('sort=price_asc&pageSize=2', { buyer: { customerGroupIds: ['group-vip'] } })
    expect(ids(firstPage)).toEqual(['p-alpha', 'p-delta'])
    expect(firstPage.totalPages).toBe(2)
    const secondPage = await list('sort=price_asc&pageSize=2&page=2', { buyer: { customerGroupIds: ['group-vip'] } })
    expect(ids(secondPage)).toEqual(['p-bravo', 'p-charlie'])
  })

  it("past the cap with 'approximate' sorts by the channel default kind and flags it", async () => {
    world.prices.push(VIP_ALPHA_PRICE)
    const response = await list('sort=price_asc', { buyer: { customerGroupIds: ['group-vip'] }, cap: 2 })
    expect(ids(response)).toEqual(['p-delta', 'p-bravo', 'p-alpha', 'p-charlie'])
    expect(response.appliedSort).toBe('price_asc')
    expect(response.sortApproximate).toBe(true)
    expect(response.sortUnavailable).toBe(false)
    expect(response.priceSort).toEqual({ cap: 2, fallback: 'approximate', capExceeded: true })
    expect(response.availableSorts).toContain('price_asc')
    expect(response.items.find((item) => item.id === 'p-alpha')?.price?.amount).toBe(15)
  })

  it("past the cap with 'approximate' filters by list prices and says so", async () => {
    const response = await list('priceMax=35&sort=title_asc', { cap: 2 })
    expect(ids(response)).toEqual(['p-bravo', 'p-delta'])
    expect(response.appliedFilters.price).toEqual({ min: null, max: 35, approximate: true })
  })

  it("past the cap with 'unavailable' withdraws the price sorts and applies the default", async () => {
    const response = await list('sort=price_asc', { fallback: 'unavailable', cap: 2 })
    expect(response.appliedSort).toBe('featured')
    expect(response.sortUnavailable).toBe(true)
    expect(response.sortApproximate).toBe(false)
    expect(response.availableSorts).toEqual(['title_asc', 'title_desc', 'newest', 'featured'])
    expect(ids(response)).toEqual(['p-delta', 'p-charlie', 'p-bravo', 'p-alpha'])
  })

  it("past the cap with 'unavailable' omits price sorts even when none was requested and leaves the price filter unapplied", async () => {
    const plain = await list('', { fallback: 'unavailable', cap: 2 })
    expect(plain.availableSorts).not.toContain('price_asc')
    expect(plain.sortUnavailable).toBe(false)
    const filtered = await list('priceMax=35', { fallback: 'unavailable', cap: 2 })
    expect(filtered.appliedFilters.price).toBeUndefined()
    expect(filtered.total).toBe(4)
  })

  it("keeps price sorts on offer under 'unavailable' while the set is within the cap", async () => {
    const response = await list('sort=price_desc', { fallback: 'unavailable', cap: 10 })
    expect(response.appliedSort).toBe('price_desc')
    expect(response.availableSorts).toContain('price_desc')
  })
})

describe('listStorefrontProducts — page-scoped availability (D21)', () => {
  it('filters the returned page only and keeps the pre-availability totals', async () => {
    world.availability['p-charlie'] = { state: 'backorder', canFulfil: true }
    const firstPage = await list('availability=in_stock&pageSize=2')
    expect(ids(firstPage)).toEqual(['p-delta'])
    expect(firstPage.total).toBe(4)
    expect(firstPage.totalPages).toBe(2)
    expect(firstPage.appliedFilters.availability).toEqual({ value: 'in_stock', scope: 'page' })
    expect(firstPage.facets.availabilityScope).toBe('page')
    expect(counters.availability).toBe(1)

    const secondPage = await list('availability=in_stock&pageSize=2&page=2')
    expect(ids(secondPage)).toEqual(['p-bravo', 'p-alpha'])

    const available = await list('availability=available&pageSize=2')
    expect(ids(available)).toEqual(['p-delta', 'p-charlie'])
    expect(available.items[1].availability).toEqual({ state: 'backorder', canFulfil: true, leadTimeDays: 7, releaseAt: null })
  })

  it('may return an empty page without re-querying to fill it', async () => {
    world.availability['p-delta'] = { state: 'out_of_stock', canFulfil: false }
    world.availability['p-charlie'] = { state: 'out_of_stock', canFulfil: false }
    const unfiltered = await list('pageSize=2')
    const unfilteredQueryEngineCalls = counters.queryEngine
    resetCounters()
    const response = await list('availability=available&pageSize=2')
    expect(unfiltered.items).toHaveLength(2)
    expect(response.items).toEqual([])
    expect(response.total).toBe(4)
    expect(counters.queryEngine).toBe(unfilteredQueryEngineCalls)
  })

  it('hides out-of-stock items whose resolved policy says hideWhenOutOfStock, page-scoped', async () => {
    world.availability['p-bravo'] = { state: 'out_of_stock', canFulfil: false }
    const shown = await list('pageSize=2&page=2')
    expect(ids(shown)).toEqual(['p-bravo', 'p-alpha'])
    expect(shown.items[0].availability.state).toBe('out_of_stock')

    world.hideWhenOutOfStock.add('p-bravo')
    resetCounters()
    const hidden = await list('pageSize=2&page=2')
    expect(ids(hidden)).toEqual(['p-alpha'])
    expect(hidden.total).toBe(4)
    expect(counters.policies).toBe(1)
  })
})

describe('listStorefrontProducts — query budget (§10)', () => {
  it('stays within 14 queries for a plain page', async () => {
    await list('')
    expect(totalQueries()).toBeLessThanOrEqual(14)
    expect(counters.queryEngine).toBe(3)
    expect(counters.translations).toBe(1)
  })

  it('stays within 14 queries for a price-sorted page', async () => {
    await list('sort=price_asc')
    expect(totalQueries()).toBeLessThanOrEqual(14)
  })

  it('does not issue per-item queries as the page grows', async () => {
    await list('pageSize=2&page=2')
    const single = totalQueries()
    resetCounters()
    await list('pageSize=4')
    expect(totalQueries()).toBe(single)
  })
})

function facetCounts<T extends { count: number }>(entries: T[], key: (entry: T) => string): Record<string, number> {
  return Object.fromEntries(entries.map((entry) => [key(entry), entry.count]))
}

function optionCounts(response: { facets: { options: Array<{ code: string; values: Array<{ code: string; count: number }> }> } }) {
  return Object.fromEntries(
    response.facets.options.map((option) => [option.code, facetCounts(option.values, (value) => value.code)]),
  )
}

describe('listStorefrontProducts — facets (§5.3, §5.4)', () => {
  it('keeps the other values of a selected option dimension (cross-exclusion)', async () => {
    const response = await list('options[color]=red')
    expect(ids(response)).toEqual(['p-delta'])
    expect(optionCounts(response)).toEqual({ color: { red: 1, blue: 1 }, size: { m: 1 } })
    expect(facetCounts(response.facets.productTypes, (entry) => entry.type)).toEqual({ configurable: 1 })
    expect(facetCounts(response.facets.categories, (entry) => entry.id)).toEqual({ [CAT_SHOES]: 1 })
  })

  it('counts every dimension against all active filters except its own', async () => {
    const byCategory = await list('categorySlug=dresses')
    expect(ids(byCategory).sort()).toEqual(['p-alpha', 'p-bravo'])
    expect(facetCounts(byCategory.facets.categories, (entry) => entry.id)).toEqual({
      [CAT_ROOT]: 2,
      [CAT_SHOES]: 2,
      [CAT_DRESS]: 2,
    })
    expect(facetCounts(byCategory.facets.tags, (entry) => entry.slug)).toEqual({ sale: 1 })
    expect(facetCounts(byCategory.facets.productTypes, (entry) => entry.type)).toEqual({ simple: 2 })
    expect(byCategory.facets.options).toEqual([])

    const byTag = await list('tagSlugs=new')
    expect(ids(byTag)).toEqual(['p-charlie'])
    expect(facetCounts(byTag.facets.tags, (entry) => entry.slug)).toEqual({ new: 1, sale: 1 })
    expect(facetCounts(byTag.facets.categories, (entry) => entry.id)).toEqual({ [CAT_SHOES]: 1 })

    const byType = await list('productType=configurable')
    expect(facetCounts(byType.facets.productTypes, (entry) => entry.type)).toEqual({ simple: 3, configurable: 1 })
    expect(facetCounts(byType.facets.tags, (entry) => entry.slug)).toEqual({})
  })

  it('combines option codes on the same variant and excludes only the dimension being counted', async () => {
    const response = await list('options[color]=red&options[size]=l')
    expect(response.items).toEqual([])
    expect(optionCounts(response)).toEqual({ color: { blue: 1 }, size: { m: 1 } })
  })

  it('counts within the search universe', async () => {
    searchTerm = 'dress'
    const response = await list('search=dress')
    expect(ids(response).sort()).toEqual(['p-alpha', 'p-bravo'])
    expect(facetCounts(response.facets.categories, (entry) => entry.id)).toEqual({ [CAT_ROOT]: 2, [CAT_DRESS]: 2 })
    expect(response.facets.priceRange).toEqual({ min: 30, max: 50, currencyCode: 'EUR' })
  })

  it('omits categories outside the buyer assortment and never counts products outside it', async () => {
    const response = await list('', { buyer: { assortmentScope: [{ categoryIds: [CAT_ROOT] }] } })
    expect(facetCounts(response.facets.categories, (entry) => entry.id)).toEqual({ [CAT_ROOT]: 2, [CAT_DRESS]: 2 })
    expect(facetCounts(response.facets.tags, (entry) => entry.slug)).toEqual({ sale: 1 })
    expect(response.facets.options).toEqual([])
    const denied = await list('', { buyer: { assortmentScope: [] } })
    expect(denied.facets).toMatchObject({ categories: [], tags: [], options: [], productTypes: [], priceRange: null, total: 0 })
  })

  it('ranges prices over the filtered set without the price filter, in the buyer prices', async () => {
    const filtered = await list('priceMax=35')
    expect(ids(filtered).sort()).toEqual(['p-bravo', 'p-delta'])
    expect(filtered.facets.priceRange).toEqual({ min: 20, max: 80, currencyCode: 'EUR' })
    expect(facetCounts(filtered.facets.categories, (entry) => entry.id)).toMatchObject({ [CAT_ROOT]: 2, [CAT_SHOES]: 2 })

    world.prices.push(VIP_ALPHA_PRICE)
    const vip = await list('', { buyer: { customerGroupIds: ['group-vip'] } })
    expect(vip.facets.priceRange).toEqual({ min: 15, max: 80, currencyCode: 'EUR' })
  })

  it('ranges past the cap by list prices under approximate and returns null under unavailable', async () => {
    world.prices.push(VIP_ALPHA_PRICE)
    const approximate = await list('sort=price_asc', { cap: 2, buyer: { customerGroupIds: ['group-vip'] } })
    expect(approximate.facets.priceRange).toEqual({ min: 20, max: 80, currencyCode: 'EUR' })
    const unavailable = await list('', { cap: 2, fallback: 'unavailable' })
    expect(unavailable.facets.priceRange).toBeNull()
    expect(unavailable.facets.categories).not.toEqual([])
  })

  it('skips the full candidate and list-price load past the cap when no price sort or filter asks for it', async () => {
    const plain = await list('sort=title_asc', { cap: 2 })
    expect(plain.facets.priceRange).toBeNull()
    expect(plain.priceSort).toEqual({ cap: 2, fallback: 'approximate', capExceeded: true })
    expect(plain.sortApproximate).toBe(false)
    expect(ids(plain)).toEqual(['p-alpha', 'p-bravo', 'p-charlie', 'p-delta'])
    const candidateQueries = queryEngineCalls.filter((call) => call.fields?.join(',') === 'id,title,sku')
    expect(candidateQueries).toHaveLength(1)
    expect(candidateQueries[0].page?.pageSize).toBe(2)
    const listPriceLoads = mockedFind.mock.calls.filter(
      ([, entity, where]) => entity === CatalogProductPrice && (where as Record<string, unknown>).customerId === null,
    )
    expect(listPriceLoads).toHaveLength(0)

    resetCounters()
    mockedFind.mockClear()
    const filtered = await list('priceMax=35&sort=title_asc', { cap: 2 })
    expect(filtered.facets.priceRange).not.toBeNull()
    expect(queryEngineCalls.filter((call) => call.fields?.join(',') === 'id,title,sku').map((call) => call.page?.pageSize)).toEqual([2, 4])
    expect(
      mockedFind.mock.calls.filter(
        ([, entity, where]) => entity === CatalogProductPrice && (where as Record<string, unknown>).customerId === null,
      ),
    ).toHaveLength(1)
  })

  it('counts availability over the returned page before the availability filter', async () => {
    world.availability['p-charlie'] = { state: 'backorder', canFulfil: true }
    const response = await list('availability=in_stock&pageSize=2')
    expect(ids(response)).toEqual(['p-delta'])
    expect(response.facets.availabilityScope).toBe('page')
    expect(response.facets.availability).toEqual([
      { state: 'in_stock', count: 1 },
      { state: 'backorder', count: 1 },
    ])
    expect(response.facets.availability.reduce((sum, entry) => sum + entry.count, 0)).toBe(2)
  })

  it('loads the facet universe once whatever filters are active', async () => {
    await list('')
    const plain = { ...counters }
    resetCounters()
    await list('options[color]=red&productType=configurable&sort=title_asc')
    expect(counters.assignments).toBe(1)
    expect(plain.assignments).toBe(1)
    expect(counters.queryEngine).toBe(plain.queryEngine)
  })
})

describe('listStorefrontProducts — facet cache split (§9.1)', () => {
  it('caches count facets by assortment scope and shares them across buyers with different prices', async () => {
    world.prices.push(VIP_ALPHA_PRICE)
    const cache = createMemoryStrategy()
    const setSpy = jest.spyOn(cache, 'set')
    const anonymous = await list('', { cache })
    const countFacetKeys = setSpy.mock.calls.map(([key]) => String(key)).filter((key) => key.includes('products-count-facets'))
    expect(countFacetKeys).toHaveLength(1)
    expect(countFacetKeys[0].startsWith('ecommerce:storefront:assortment:store-1:pl:none:')).toBe(true)
    expect(countFacetKeys[0]).not.toContain('digest')

    resetCounters()
    const vip = await list('', { cache, buyer: { customerGroupIds: ['group-vip'], priceScopeKey: 'vip' } })
    expect(counters.assignments).toBe(0)
    expect(counters.queryEngine).toBe(2)
    expect(vip.facets.categories).toEqual(anonymous.facets.categories)
    expect(vip.facets.options).toEqual(anonymous.facets.options)
    expect(anonymous.facets.priceRange).toEqual({ min: 20, max: 80, currencyCode: 'EUR' })
    expect(vip.facets.priceRange).toEqual({ min: 15, max: 80, currencyCode: 'EUR' })
  })

  it('does not share count facets across assortment scopes or facet filters', async () => {
    const cache = createMemoryStrategy()
    await list('', { cache })
    resetCounters()
    await list('', { cache, buyer: { assortmentScope: [{ categoryIds: [CAT_ROOT] }], assortmentScopeHash: 'clothing' } })
    expect(counters.assignments).toBe(1)
    resetCounters()
    await list('tagSlugs=sale', { cache })
    expect(counters.assignments).toBe(1)
    resetCounters()
    await list('sort=price_desc&priceMax=60&page=1', { cache })
    expect(counters.assignments).toBe(0)
  })

  it('stays within 14 queries with facets for a plain and a price-sorted page, fewer on a count-facet hit', async () => {
    const cache = createMemoryStrategy()
    await list('', { cache })
    expect(totalQueries()).toBeLessThanOrEqual(14)
    resetCounters()
    await list('sort=price_asc', { cache: createMemoryStrategy() })
    expect(totalQueries()).toBeLessThanOrEqual(14)
    resetCounters()
    await list('', { cache })
    expect(totalQueries()).toBeLessThanOrEqual(10)
  })
})
