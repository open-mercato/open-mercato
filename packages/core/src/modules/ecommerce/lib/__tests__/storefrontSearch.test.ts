import type { AwilixContainer } from 'awilix'
import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { normalizeFilters, type NormalizedFilter } from '@open-mercato/shared/lib/query/join-utils'
import type { QueryOptions, Where } from '@open-mercato/shared/lib/query/types'
import type { SearchOptions, SearchResult, SearchStrategy } from '@open-mercato/shared/modules/search'
import { ecommerceStoreSettingsSchema } from '../../data/validators'
import { loadStorefrontVisibleCategories, type StorefrontVisibleCategory } from '../storefrontCategories'
import {
  loadStorefrontTranslations,
  resolveStorefrontAvailability,
  storefrontAvailabilityKey,
} from '../storefrontCatalogSupport'
import { resolveStorefrontPrices } from '../storefrontPricing'
import { buildStorefrontProductFilterClause } from '../storefrontProducts'
import {
  readStorefrontSearchBackendPreference,
  selectStorefrontSearchBackend,
  suggestStorefrontSearch,
  type StorefrontSearchBackendPreference,
} from '../storefrontSearch'
import type { BuyerContext, StoreContext } from '../types'
import { evaluateIndexDocFilter } from './indexDocFilterEvaluator'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: reportErrorMock }),
}))

jest.mock('../storefrontPricing', () => ({ resolveStorefrontPrices: jest.fn() }))

jest.mock('../storefrontCategories', () => ({ loadStorefrontVisibleCategories: jest.fn() }))

jest.mock('../storefrontProducts', () => ({ buildStorefrontProductFilterClause: jest.fn() }))

jest.mock('../storefrontCatalogSupport', () => ({
  ...jest.requireActual('../storefrontCatalogSupport'),
  loadStorefrontTranslations: jest.fn(),
  resolveStorefrontAvailability: jest.fn(),
}))

const reportErrorMock = jest.fn()
const mockedFind = findWithDecryption as jest.Mock
const mockedPrices = resolveStorefrontPrices as jest.Mock
const mockedCategories = loadStorefrontVisibleCategories as jest.Mock
const mockedFilterClause = buildStorefrontProductFilterClause as jest.Mock
const mockedTranslations = loadStorefrontTranslations as jest.Mock
const mockedAvailability = resolveStorefrontAvailability as jest.Mock

const TENANT_ID = 'tenant-1'
const ORGANIZATION_ID = 'org-1'
const PRODUCT_ENTITY = 'catalog:catalog_product'

type ProductFixture = {
  id: string
  title: string
  sku: string
  categoryIds: string[]
  score: number
  isActive?: boolean
  tenantId?: string
  hideWhenOutOfStock?: boolean
}

type ProductRow = Record<string, unknown> & { id: string; title: string; sku: string }

let products: ProductFixture[] = []
let categories: StorefrontVisibleCategory[] = []
const counters = { engine: 0, strategy: 0 }
const engineCalls: QueryOptions[] = []
const strategyCalls: SearchOptions[] = []

function scopeKeys(product: ProductFixture): string[] {
  return product.categoryIds.map((id) => `cat:${id}`).sort((left, right) => left.localeCompare(right))
}

function productRow(product: ProductFixture): ProductRow {
  return {
    id: product.id,
    title: product.title,
    sku: product.sku,
    handle: product.id,
    default_media_url: `https://cdn.example.com/${product.id}.jpg`,
    tenant_id: product.tenantId ?? TENANT_ID,
    organization_id: ORGANIZATION_ID,
    deleted_at: null,
    is_active: product.isActive ?? true,
    scope_keys: scopeKeys(product),
  }
}

function listOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry)) : [String(value)]
}

function evaluateLeaf(row: ProductRow, filter: NormalizedFilter): boolean {
  const actual = row[filter.field]
  switch (filter.op) {
    case 'eq':
      return filter.value === null ? actual === null || actual === undefined : actual === filter.value
    case 'in':
      return listOf(filter.value).includes(String(actual))
    case 'nin':
      return !listOf(filter.value).includes(String(actual))
    case 'exists':
      return filter.value ? actual !== undefined && actual !== null : actual === undefined || actual === null
    case 'overlap':
      return Array.isArray(actual) && actual.some((entry) => listOf(filter.value).includes(String(entry)))
    case 'noverlap':
      return Array.isArray(actual) && !actual.some((entry) => listOf(filter.value).includes(String(entry)))
    default:
      throw new Error(`[internal] fake query engine does not support ${filter.op}`)
  }
}

function rowMatches(row: ProductRow, filters: Where): boolean {
  const normalized = normalizeFilters(filters)
  if (!normalized.filter((filter) => !filter.orGroup).every((filter) => evaluateLeaf(row, filter))) return false
  const groups = new Map<string, NormalizedFilter[]>()
  for (const filter of normalized) {
    if (!filter.orGroup) continue
    groups.set(filter.orGroup, [...(groups.get(filter.orGroup) ?? []), filter])
  }
  if (groups.size === 0) return true
  return Array.from(groups.values()).some((group) => group.every((filter) => evaluateLeaf(row, filter)))
}

const queryEngine = {
  async query(_entity: string, options: QueryOptions = {}) {
    counters.engine += 1
    engineCalls.push(options)
    const rows = products
      .map(productRow)
      .filter(
        (row) =>
          row.tenant_id === options.tenantId &&
          row.organization_id === options.organizationId &&
          rowMatches(row, (options.filters ?? {}) as Where),
      )
      .sort((left, right) => left.title.localeCompare(right.title))
    const pageSize = options.page?.pageSize ?? 20
    return { items: rows.slice(0, pageSize), total: rows.length, page: 1, pageSize }
  },
}

type FakeStrategyOptions = {
  id: string
  supportsIndexDocFilter?: boolean
  ignoreFilter?: boolean
  ignoreTenant?: boolean
  fail?: boolean
}

function fakeStrategy(options: FakeStrategyOptions): SearchStrategy {
  return {
    id: options.id,
    name: options.id,
    priority: 1,
    supportsIndexDocFilter: options.supportsIndexDocFilter,
    isAvailable: async () => true,
    ensureReady: async () => {},
    index: async () => {},
    delete: async () => {},
    async search(query: string, searchOptions: SearchOptions): Promise<SearchResult[]> {
      counters.strategy += 1
      strategyCalls.push(searchOptions)
      if (options.fail) throw new Error('[internal] search backend down')
      const needle = query.toLowerCase()
      const filter = options.ignoreFilter ? undefined : searchOptions.indexDocFilter
      return products
        .filter((product) => options.ignoreTenant || (product.tenantId ?? TENANT_ID) === searchOptions.tenantId)
        .filter((product) => product.title.toLowerCase().includes(needle))
        .filter((product) => {
          if (!filter) return true
          const row = productRow(product)
          return evaluateIndexDocFilter({ id: product.id, doc: { is_active: row.is_active, scope_keys: row.scope_keys } }, filter)
        })
        .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
        .slice(0, searchOptions.limit ?? 50)
        .map((product) => ({ entityId: PRODUCT_ENTITY, recordId: product.id, score: product.score, source: options.id }))
    },
  }
}

type RegistryOptions = { strategies: SearchStrategy[]; unavailable?: string[]; throwing?: string[] }

function searchRegistry(options: RegistryOptions) {
  return {
    getStrategy: (id: string) => options.strategies.find((strategy) => strategy.id === id),
    isStrategyAvailable: async (id: string) => {
      if (options.throwing?.includes(id)) throw new Error('[internal] probe failed')
      return options.strategies.some((strategy) => strategy.id === id) && !options.unavailable?.includes(id)
    },
  }
}

function makeContainer(searchService: unknown = null): AwilixContainer {
  return {
    resolve: (name: string) => {
      if (name === 'em') return { getKysely: () => ({}) }
      if (name === 'queryEngine') return queryEngine
      if (name === 'searchService' && searchService) return searchService
      throw new Error(`[internal] ${name} is not registered`)
    },
  } as unknown as AwilixContainer
}

const baseBuyer: BuyerContext = {
  customerUserId: null,
  customerId: null,
  companyId: null,
  customerIds: [],
  customerGroupIds: [],
  isAuthenticated: false,
  taxMode: 'gross',
  priceKindId: null,
  allowPurchaseOnAccount: false,
  approvalRequiredAbove: null,
  assortmentScope: null,
  assortmentScopeHash: 'aaaaaaaaaaaaaaaa',
  priceScopeKey: 'bbbbbbbbbbbbbbbb',
  customerOverlayId: null,
}

function makeContext(assortmentScope: EffectiveAssortmentScope = null, effectiveLocale = 'en'): StoreContext {
  return {
    store: {
      id: 'store-1',
      code: 'main',
      name: 'Main store',
      slug: 'main',
      status: 'active',
      defaultLocale: 'en',
      supportedLocales: ['en', 'pl'],
      defaultCurrencyCode: 'EUR',
      settings: ecommerceStoreSettingsSchema.parse({}),
    },
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    channel: { channelBindingId: 'binding-1', salesChannelId: 'channel-1', priceKindId: null, priceSortFallback: 'approximate' },
    buyer: { ...baseBuyer, assortmentScope },
    effectiveLocale,
    requestedLocale: null,
    currencyCode: 'EUR',
    digest: 'digest-1',
  }
}

function category(id: string, name: string): StorefrontVisibleCategory {
  return { id, name, slug: id, description: null, depth: 0, parentId: null, isActive: true, ancestorIds: [], descendantIds: [] }
}

function suggest(
  container: AwilixContainer,
  ctx: StoreContext,
  q: string,
  limit = 8,
  backendPreference: StorefrontSearchBackendPreference = 'auto',
) {
  return suggestStorefrontSearch(container, ctx, { q, limit }, { backendPreference })
}

beforeEach(() => {
  products = []
  categories = []
  counters.engine = 0
  counters.strategy = 0
  engineCalls.length = 0
  strategyCalls.length = 0
  reportErrorMock.mockReset()
  mockedFind.mockReset()
  mockedFind.mockImplementation(async (_em: unknown, _entity: unknown, where: { product: { $in: string[] } }) =>
    where.product.$in.map((productId) => ({ id: `${productId}-v1`, product: productId })),
  )
  mockedPrices.mockReset()
  mockedPrices.mockImplementation(async (_container: unknown, _ctx: unknown, items: Array<{ productId: string }>) =>
    new Map(
      items.map((item) => [
        item.productId,
        { productId: item.productId, price: { formatted: `€${item.productId.length}.00` }, priceRange: null },
      ]),
    ),
  )
  mockedCategories.mockReset()
  mockedCategories.mockImplementation(async () => new Map(categories.map((entry) => [entry.id, entry])))
  mockedFilterClause.mockReset()
  mockedFilterClause.mockImplementation(async (_container: unknown, _ctx: unknown, query: { search: string }) => {
    const needle = query.search.toLowerCase()
    const ids = products
      .filter((product) => product.title.toLowerCase().includes(needle) || product.sku.toLowerCase().includes(needle))
      .map((product) => product.id)
    return { id: { $in: ids.length ? ids : ['00000000-0000-0000-0000-000000000000'] } }
  })
  mockedTranslations.mockReset()
  mockedTranslations.mockResolvedValue(new Map())
  mockedAvailability.mockReset()
  mockedAvailability.mockImplementation(async (_container: unknown, _ctx: unknown, _em: unknown, targets: Array<{ productId: string }>) =>
    new Map(
      targets.map((target) => {
        const hidden = products.find((product) => product.id === target.productId)?.hideWhenOutOfStock === true
        return [
          storefrontAvailabilityKey({ productId: target.productId, variantId: null }),
          {
            result: hidden ? { state: 'out_of_stock', canFulfil: false, leadTimeDays: null, releaseAt: null } : null,
            policy: hidden ? { hideWhenOutOfStock: { value: true } } : null,
          },
        ]
      }),
    ),
  )
})

describe('readStorefrontSearchBackendPreference', () => {
  it('accepts the three explicit backends and defaults everything else to auto', () => {
    expect(readStorefrontSearchBackendPreference('tokens')).toBe('tokens')
    expect(readStorefrontSearchBackendPreference(' Vector ')).toBe('vector')
    expect(readStorefrontSearchBackendPreference('ILIKE')).toBe('ilike')
    expect(readStorefrontSearchBackendPreference('fulltext')).toBe('auto')
    expect(readStorefrontSearchBackendPreference(undefined)).toBe('auto')
  })
})

describe('selectStorefrontSearchBackend (§8.2, D19)', () => {
  const tokens = fakeStrategy({ id: 'tokens', supportsIndexDocFilter: true })
  const pgvector = fakeStrategy({ id: 'vector', supportsIndexDocFilter: true })
  const qdrant = fakeStrategy({ id: 'vector' })
  const meilisearch = fakeStrategy({ id: 'fulltext' })

  it('falls back to ILIKE when the search module is absent', async () => {
    expect(await selectStorefrontSearchBackend(makeContainer(), 'dress', 'auto')).toEqual({ backend: 'ilike' })
  })

  it('prefers tokens, then pgvector, under auto', async () => {
    const both = makeContainer(searchRegistry({ strategies: [pgvector, tokens] }))
    expect((await selectStorefrontSearchBackend(both, 'dress', 'auto')).backend).toBe('tokens')
    const vectorOnly = makeContainer(searchRegistry({ strategies: [tokens, pgvector], unavailable: ['tokens'] }))
    expect((await selectStorefrontSearchBackend(vectorOnly, 'dress', 'auto')).backend).toBe('vector')
  })

  it('never selects Meilisearch or a vector driver that cannot evaluate the scope', async () => {
    const excluded = makeContainer(searchRegistry({ strategies: [meilisearch, qdrant] }))
    expect(await selectStorefrontSearchBackend(excluded, 'dress', 'auto')).toEqual({ backend: 'ilike' })
    expect(await selectStorefrontSearchBackend(excluded, 'dress', 'vector')).toEqual({ backend: 'ilike' })
  })

  it('skips tokens for a term too short to tokenize', async () => {
    const container = makeContainer(searchRegistry({ strategies: [tokens, pgvector] }))
    expect((await selectStorefrontSearchBackend(container, 'dr', 'auto')).backend).toBe('vector')
    expect((await selectStorefrontSearchBackend(container, 'dr', 'tokens')).backend).toBe('ilike')
  })

  it('honours an explicit preference and falls back to ILIKE, never to the other strategy', async () => {
    const container = makeContainer(searchRegistry({ strategies: [tokens, pgvector], unavailable: ['vector'] }))
    expect((await selectStorefrontSearchBackend(container, 'dress', 'vector')).backend).toBe('ilike')
    expect((await selectStorefrontSearchBackend(container, 'dress', 'ilike')).backend).toBe('ilike')
  })

  it('treats a failing availability probe as unavailable', async () => {
    const container = makeContainer(searchRegistry({ strategies: [tokens], throwing: ['tokens'] }))
    expect((await selectStorefrontSearchBackend(container, 'dress', 'auto')).backend).toBe('ilike')
  })
})

describe('suggestStorefrontSearch — scope inside the ranking query (R14)', () => {
  function starvationFixture() {
    products = [
      ...Array.from({ length: 50 }, (_, index) => ({
        id: `out-${String(index).padStart(2, '0')}`,
        title: `Silk dress ${String(index).padStart(2, '0')}`,
        sku: `OUT-${index}`,
        categoryIds: ['c-hidden'],
        score: 0.9,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `in-${String(index).padStart(2, '0')}`,
        title: `Linen dress ${String(index).padStart(2, '0')}`,
        sku: `IN-${index}`,
        categoryIds: ['c-visible'],
        score: 0.5,
      })),
    ]
  }

  it('returns a full page of in-assortment products although the unrestricted top-k is all out of scope', async () => {
    starvationFixture()
    const container = makeContainer(searchRegistry({ strategies: [fakeStrategy({ id: 'tokens', supportsIndexDocFilter: true })] }))

    const response = await suggest(container, makeContext([{ categoryIds: ['c-visible'] }]), 'dress', 8)

    expect(response.products).toHaveLength(8)
    expect(response.products.every((product) => product.id.startsWith('in-'))).toBe(true)
    expect(counters.strategy).toBe(1)
    expect(strategyCalls[0]).toMatchObject({
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
      entityTypes: [PRODUCT_ENTITY],
      limit: 8,
    })
    expect(strategyCalls[0].indexDocFilter).toEqual({
      anyOf: [
        [
          { op: 'eq', key: 'is_active', value: true },
          { op: 'exists', key: 'scope_keys' },
          { op: 'overlap', key: 'scope_keys', values: ['cat:c-visible'] },
        ],
      ],
    })
  })

  it('would starve to nothing if the backend retrieved top-k first and the scope only post-filtered it', async () => {
    starvationFixture()
    const container = makeContainer(
      searchRegistry({ strategies: [fakeStrategy({ id: 'tokens', supportsIndexDocFilter: true, ignoreFilter: true })] }),
    )

    const response = await suggest(container, makeContext([{ categoryIds: ['c-visible'] }]), 'dress', 8)

    expect(response.products).toEqual([])
  })

  it('applies the same scope on the pgvector backend', async () => {
    starvationFixture()
    const container = makeContainer(searchRegistry({ strategies: [fakeStrategy({ id: 'vector', supportsIndexDocFilter: true })] }))

    const response = await suggest(container, makeContext([{ categoryIds: ['c-visible'] }]), 'dress', 8, 'vector')

    expect(response.products.map((product) => product.id)).toHaveLength(8)
    expect(strategyCalls[0].indexDocFilter?.anyOf).toHaveLength(1)
  })
})

describe('suggestStorefrontSearch — one response shape for every backend (§8.3)', () => {
  beforeEach(() => {
    products = [
      { id: 'p-1', title: 'Boot', sku: 'B-1', categoryIds: ['c-1'], score: 1 },
      { id: 'p-2', title: 'Winter boot', sku: 'B-2', categoryIds: ['c-1'], score: 1 },
      { id: 'p-3', title: 'Bootcut jeans', sku: 'J-1', categoryIds: ['c-1'], score: 1 },
      { id: 'p-4', title: 'Sandal', sku: 'S-1', categoryIds: ['c-1'], score: 1 },
      { id: 'p-5', title: 'Hidden boot', sku: 'H-1', categoryIds: ['c-1'], score: 1, isActive: false },
    ]
    categories = [category('c-1', 'Boots'), category('c-2', 'Rain boots'), category('c-3', 'Sandals')]
  })

  it('returns identical payloads from ILIKE and tokens for the same fixture', async () => {
    const ctx = makeContext()
    const viaIlike = await suggest(makeContainer(), ctx, 'boot')
    const viaTokens = await suggest(
      makeContainer(searchRegistry({ strategies: [fakeStrategy({ id: 'tokens', supportsIndexDocFilter: true })] })),
      ctx,
      'boot',
    )

    expect(viaTokens).toEqual(viaIlike)
    expect(viaIlike).toEqual({
      products: [
        { id: 'p-1', handle: 'p-1', title: 'Boot', defaultMediaUrl: 'https://cdn.example.com/p-1.jpg', formattedPrice: '€3.00' },
        { id: 'p-3', handle: 'p-3', title: 'Bootcut jeans', defaultMediaUrl: 'https://cdn.example.com/p-3.jpg', formattedPrice: '€3.00' },
        { id: 'p-2', handle: 'p-2', title: 'Winter boot', defaultMediaUrl: 'https://cdn.example.com/p-2.jpg', formattedPrice: '€3.00' },
      ],
      categories: [
        { id: 'c-1', name: 'Boots', slug: 'c-1' },
        { id: 'c-2', name: 'Rain boots', slug: 'c-2' },
      ],
      suggestions: [],
      effectiveLocale: 'en',
    })
  })

  it('ranks by the backend score first and breaks ties by relevance, title and id', async () => {
    products[2].score = 3
    const response = await suggest(
      makeContainer(searchRegistry({ strategies: [fakeStrategy({ id: 'tokens', supportsIndexDocFilter: true })] })),
      makeContext(),
      'boot',
    )
    expect(response.products.map((product) => product.id)).toEqual(['p-3', 'p-1', 'p-2'])
  })

  it('costs one ranking query and one product re-read on a search backend, two engine queries on ILIKE', async () => {
    await suggest(
      makeContainer(searchRegistry({ strategies: [fakeStrategy({ id: 'tokens', supportsIndexDocFilter: true })] })),
      makeContext(),
      'boot',
    )
    expect(counters.strategy).toBe(1)
    expect(counters.engine).toBe(1)
    expect(mockedFilterClause).not.toHaveBeenCalled()

    counters.engine = 0
    engineCalls.length = 0
    await suggest(makeContainer(), makeContext(), 'boot')
    expect(counters.engine).toBe(2)
    expect(engineCalls[0].page?.pageSize).toBe(100)
    expect(mockedFilterClause).toHaveBeenCalledTimes(1)
    expect(mockedFind).toHaveBeenCalledTimes(2)
    expect(mockedCategories).toHaveBeenCalledTimes(2)
    expect(mockedTranslations).toHaveBeenCalledTimes(2)
  })

  it('falls back to ILIKE and reports the error when the search backend fails', async () => {
    const response = await suggest(
      makeContainer(searchRegistry({ strategies: [fakeStrategy({ id: 'tokens', supportsIndexDocFilter: true, fail: true })] })),
      makeContext(),
      'boot',
    )
    expect(response.products.map((product) => product.id)).toEqual(['p-1', 'p-3', 'p-2'])
    expect(reportErrorMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ code: 'ecommerce.storefront_search_backend_failed' }),
    )
  })

  it('caps products and categories at limit', async () => {
    const response = await suggest(makeContainer(), makeContext(), 'boot', 1)
    expect(response.products.map((product) => product.id)).toEqual(['p-1'])
    expect(response.categories.map((entry) => entry.id)).toEqual(['c-1'])
  })
})

describe('suggestStorefrontSearch — buyer visibility', () => {
  it('returns empty arrays for a term shorter than two characters without touching any backend', async () => {
    products = [{ id: 'p-1', title: 'A', sku: 'A', categoryIds: [], score: 1 }]
    const response = await suggest(makeContainer(), makeContext(), ' a ')
    expect(response).toEqual({ products: [], categories: [], suggestions: [], effectiveLocale: 'en' })
    expect(counters.engine).toBe(0)
    expect(mockedCategories).not.toHaveBeenCalled()
  })

  it('returns empty arrays for a deny-all assortment (closed require_authentication channel) at zero cost', async () => {
    products = [{ id: 'p-1', title: 'Boot', sku: 'B-1', categoryIds: [], score: 1 }]
    categories = [category('c-1', 'Boots')]
    const container = makeContainer(searchRegistry({ strategies: [fakeStrategy({ id: 'tokens', supportsIndexDocFilter: true })] }))
    const response = await suggest(container, makeContext([]), 'boot')
    expect(response).toEqual({ products: [], categories: [], suggestions: [], effectiveLocale: 'en' })
    expect(counters.strategy).toBe(0)
    expect(counters.engine).toBe(0)
    expect(mockedCategories).not.toHaveBeenCalled()
  })

  it('omits products whose policy hides them when out of stock', async () => {
    products = [
      { id: 'p-1', title: 'Boot', sku: 'B-1', categoryIds: [], score: 1 },
      { id: 'p-2', title: 'Boot sold out', sku: 'B-2', categoryIds: [], score: 1, hideWhenOutOfStock: true },
    ]
    const response = await suggest(makeContainer(), makeContext(), 'boot')
    expect(response.products.map((product) => product.id)).toEqual(['p-1'])
  })

  it('never returns another tenant\'s product, even when a backend ranks it', async () => {
    products = [
      { id: 'p-1', title: 'Boot', sku: 'B-1', categoryIds: [], score: 1 },
      { id: 'p-foreign', title: 'Boot foreign', sku: 'B-9', categoryIds: [], score: 5, tenantId: 'tenant-2' },
    ]
    const leaky = fakeStrategy({ id: 'tokens', supportsIndexDocFilter: true, ignoreTenant: true })
    const viaBackend = await suggest(makeContainer(searchRegistry({ strategies: [leaky] })), makeContext(), 'boot')
    expect(viaBackend.products.map((product) => product.id)).toEqual(['p-1'])
    const viaIlike = await suggest(makeContainer(), makeContext(), 'boot')
    expect(viaIlike.products.map((product) => product.id)).toEqual(['p-1'])
  })

  it('matches categories on the localized name in the effective locale, accent-insensitively', async () => {
    categories = [category('c-1', 'Shoes'), category('c-2', 'Café')]
    mockedTranslations.mockResolvedValue(
      new Map([['catalog:catalog_product_category', new Map([['c-1', { pl: { name: 'Buty' } }]])]]),
    )
    const polish = await suggest(makeContainer(), makeContext(null, 'pl'), 'but')
    expect(polish.categories).toEqual([{ id: 'c-1', name: 'Buty', slug: 'c-1' }])
    expect(polish.effectiveLocale).toBe('pl')
    const accented = await suggest(makeContainer(), makeContext(), 'cafe')
    expect(accented.categories).toEqual([{ id: 'c-2', name: 'Café', slug: 'c-2' }])
  })
})
