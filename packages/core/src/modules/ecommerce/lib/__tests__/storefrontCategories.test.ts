import type { AwilixContainer } from 'awilix'
import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { normalizeFilters, type NormalizedFilter } from '@open-mercato/shared/lib/query/join-utils'
import type { QueryOptions, Where } from '@open-mercato/shared/lib/query/types'
import { CatalogProductCategory } from '@open-mercato/core/modules/catalog/data/entities'
import { batchLoadTranslationsMany } from '@open-mercato/core/modules/translations/lib/batch'
import { ecommerceStoreSettingsSchema } from '../../data/validators'
import {
  countProductsPerCategory,
  getStorefrontCategoryLanding,
  getStorefrontCategoryTree,
} from '../storefrontCategories'
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
const ROOT = '0b8f3f0e-1d2a-4c5b-8e6f-000000000001'
const DRESS = '0b8f3f0e-1d2a-4c5b-8e6f-000000000002'
const SKIRT = '0b8f3f0e-1d2a-4c5b-8e6f-000000000003'
const SHOES = '0b8f3f0e-1d2a-4c5b-8e6f-000000000004'
const ARCHIVE = '0b8f3f0e-1d2a-4c5b-8e6f-000000000005'
const ARCHIVE_CHILD = '0b8f3f0e-1d2a-4c5b-8e6f-000000000006'
const OTHER_TENANT_CATEGORY = '0b8f3f0e-1d2a-4c5b-8e6f-000000000007'

type CategoryFixture = {
  id: string
  name: string
  slug: string
  description: string | null
  depth: number
  parentId: string | null
  ancestorIds: string[]
  descendantIds: string[]
  isActive: boolean
  deletedAt: Date | null
  tenantId: string
  organizationId: string
}

function category(
  id: string,
  slug: string,
  name: string,
  ancestorIds: string[],
  descendantIds: string[],
  overrides: Partial<CategoryFixture> = {},
): CategoryFixture {
  return {
    id,
    name,
    slug,
    description: `${name} description`,
    depth: ancestorIds.length,
    parentId: ancestorIds[ancestorIds.length - 1] ?? null,
    ancestorIds,
    descendantIds,
    isActive: true,
    deletedAt: null,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    ...overrides,
  }
}

const CATEGORIES: CategoryFixture[] = [
  category(ROOT, 'clothing', 'Clothing', [], [DRESS, SKIRT]),
  category(DRESS, 'dresses', 'Dresses', [ROOT], []),
  category(SKIRT, 'skirts', 'Skirts', [ROOT], []),
  category(SHOES, 'shoes', 'Shoes', [], []),
  category(ARCHIVE, 'archive', 'Archive', [], [ARCHIVE_CHILD], { isActive: false }),
  category(ARCHIVE_CHILD, 'archived-shoes', 'Archived shoes', [ARCHIVE], []),
]

const OTHER_TENANT_CATEGORIES: CategoryFixture[] = [
  category(OTHER_TENANT_CATEGORY, 'secret', 'Secret', [], [], { tenantId: 'tenant-2' }),
]

type ProductFixture = { id: string; categoryIds: string[]; isActive?: boolean }

const PRODUCTS: ProductFixture[] = [
  { id: 'p-1', categoryIds: [DRESS] },
  { id: 'p-2', categoryIds: [DRESS, ROOT] },
  { id: 'p-3', categoryIds: [SHOES] },
  { id: 'p-4', categoryIds: [DRESS], isActive: false },
  { id: 'p-5', categoryIds: [ARCHIVE_CHILD] },
]

const TRANSLATIONS: Record<string, Record<string, Record<string, Record<string, unknown>>>> = {
  'catalog:catalog_product_category': {
    [ROOT]: { pl: { name: 'Odzież', description: 'Opis odzieży' } },
    [SHOES]: { pl: { name: 'Buty' }, en: { description: 'English shoes' } },
    [DRESS]: { pl: { name: '   ' } },
  },
}

const counters = { engine: 0, find: 0, assignments: 0, translations: 0 }
const engineCalls: QueryOptions[] = []
let lastUniverseIds: string[] = []
let extraUniverseTotal = 0
let tenantCategories: CategoryFixture[] = [...CATEGORIES, ...OTHER_TENANT_CATEGORIES]

function totalQueries(): number {
  return counters.engine + counters.find + counters.assignments + counters.translations
}

function resetCounters() {
  counters.engine = 0
  counters.find = 0
  counters.assignments = 0
  counters.translations = 0
  engineCalls.length = 0
  lastUniverseIds = []
  extraUniverseTotal = 0
}

function indexRow(product: ProductFixture): Record<string, unknown> & { id: string } {
  const scopeKeys = new Set<string>()
  for (const categoryId of product.categoryIds) {
    scopeKeys.add(`cat:${categoryId}`)
    for (const ancestorId of CATEGORIES.find((entry) => entry.id === categoryId)?.ancestorIds ?? []) {
      scopeKeys.add(`cat:${ancestorId}`)
    }
  }
  return {
    id: product.id,
    tenant_id: TENANT_ID,
    organization_id: ORGANIZATION_ID,
    deleted_at: null,
    is_active: product.isActive ?? true,
    product_type: 'simple',
    option_schema_id: null,
    scope_keys: Array.from(scopeKeys),
  }
}

function evaluateLeaf(row: Record<string, unknown>, filter: NormalizedFilter): boolean {
  const actual = row[filter.field]
  const list = Array.isArray(filter.value) ? filter.value.map(String) : [String(filter.value)]
  switch (filter.op) {
    case 'eq':
      return filter.value === null ? actual === null || actual === undefined : actual === filter.value
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

function rowMatches(row: Record<string, unknown>, filters: Where): boolean {
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
    const rows = PRODUCTS.map(indexRow).filter(
      (row) =>
        row.tenant_id === options.tenantId &&
        row.organization_id === options.organizationId &&
        rowMatches(row, (options.filters ?? {}) as Where),
    )
    lastUniverseIds = rows.map((row) => row.id)
    return {
      items: rows.map((row) => ({ id: row.id })),
      total: rows.length + extraUniverseTotal,
      page: 1,
      pageSize: options.page?.pageSize ?? 20,
    }
  },
}

const kyselyBuilder: Record<string, unknown> = {}
for (const method of ['selectFrom', 'select', 'where']) {
  kyselyBuilder[method] = () => kyselyBuilder
}
kyselyBuilder.execute = async () => {
  counters.assignments += 1
  return PRODUCTS.filter((product) => lastUniverseIds.includes(product.id)).flatMap((product) =>
    product.categoryIds.map((categoryId) => ({ product_id: product.id, category_id: categoryId })),
  )
}

const em = {
  fork() {
    return em
  },
  getKysely() {
    return kyselyBuilder
  },
}

function makeContainer(): AwilixContainer {
  const services: Record<string, unknown> = { em, queryEngine }
  return {
    resolve: (name: string) => {
      const service = services[name]
      if (service === undefined) throw new Error(`[internal] not registered: ${name}`)
      return service
    },
  } as unknown as AwilixContainer
}

function makeBuyer(assortmentScope: EffectiveAssortmentScope = null): BuyerContext {
  return {
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
    assortmentScope,
    assortmentScopeHash: 'scope-hash',
    priceScopeKey: 'price-key',
    customerOverlayId: null,
  }
}

function makeContext(assortmentScope: EffectiveAssortmentScope = null, locale = 'pl'): StoreContext {
  return {
    store: {
      id: 'store-1',
      code: 'main',
      name: 'Main',
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
    buyer: makeBuyer(assortmentScope),
    effectiveLocale: locale,
    requestedLocale: null,
    currencyCode: 'EUR',
    digest: 'digest-1',
  }
}

type TreeQuery = { parentId?: string; depth?: number; includeEmpty: boolean }

function treeQuery(overrides: Partial<TreeQuery> = {}): TreeQuery {
  return { includeEmpty: false, ...overrides }
}

function names(nodes: Array<{ name: string; children: unknown[] }>): string[] {
  return nodes.map((node) => node.name)
}

beforeEach(() => {
  resetCounters()
  tenantCategories = [...CATEGORIES, ...OTHER_TENANT_CATEGORIES]
  mockedFind.mockReset()
  mockedFind.mockImplementation(async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
    counters.find += 1
    if (entity !== CatalogProductCategory) return []
    return tenantCategories.filter(
      (entry) => entry.tenantId === where.tenantId && entry.organizationId === where.organizationId && entry.deletedAt === null,
    )
  })
  mockedTranslations.mockReset()
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
})

describe('countProductsPerCategory', () => {
  it('counts a product once per category and ancestor however many assignments share an ancestor', () => {
    const ancestors = new Map<string, string[]>([
      ['child-a', ['root']],
      ['child-b', ['root']],
      ['root', []],
    ])
    const counts = countProductsPerCategory(
      new Map([
        ['p1', ['child-a', 'child-b']],
        ['p2', ['child-a']],
        ['p3', ['unknown']],
      ]),
      (id) => ancestors.get(id) ?? null,
    )
    expect(Object.fromEntries(counts)).toEqual({ root: 2, 'child-a': 2, 'child-b': 1 })
  })
})

describe('getStorefrontCategoryTree', () => {
  it('builds the tree with descendant-inclusive counts over the assortment universe, localized and sorted', async () => {
    const result = await getStorefrontCategoryTree(makeContainer(), makeContext(), treeQuery())
    expect(result.effectiveLocale).toBe('pl')
    expect(names(result.tree)).toEqual(['Buty', 'Odzież'])
    const clothing = result.tree[1]
    expect(clothing).toMatchObject({
      id: ROOT,
      slug: 'clothing',
      description: 'Opis odzieży',
      depth: 0,
      parentId: null,
      productCount: 2,
      hasChildren: true,
    })
    expect(clothing.children).toHaveLength(1)
    expect(clothing.children[0]).toMatchObject({
      id: DRESS,
      name: 'Dresses',
      description: 'Dresses description',
      parentId: ROOT,
      productCount: 2,
      hasChildren: false,
      children: [],
    })
    expect(result.tree[0]).toMatchObject({ id: SHOES, productCount: 1, description: 'English shoes' })
  })

  it('applies the assortment invariant in the universe query and hides inactive or other-tenant categories', async () => {
    const result = await getStorefrontCategoryTree(makeContainer(), makeContext(), treeQuery({ includeEmpty: true }))
    const all = JSON.stringify(result.tree)
    expect(all).not.toContain(ARCHIVE)
    expect(all).not.toContain(ARCHIVE_CHILD)
    expect(all).not.toContain(OTHER_TENANT_CATEGORY)
    expect(engineCalls).toHaveLength(1)
    expect(engineCalls[0]).toMatchObject({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, withDeleted: false })
    expect(engineCalls[0].filters).toMatchObject({ tenant_id: TENANT_ID, organization_id: ORGANIZATION_ID, deleted_at: null, is_active: true })
  })

  it('counts only products inside a restricted buyer assortment and hides categories it cannot browse', async () => {
    const restricted = makeContext([{ categoryIds: [SHOES] }])
    const result = await getStorefrontCategoryTree(makeContainer(), restricted, treeQuery({ includeEmpty: true }))
    expect(result.tree.map((node) => node.id)).toEqual([SHOES])
    expect(result.tree[0].productCount).toBe(1)
    expect(lastUniverseIds).toEqual(['p-3'])
    const withinDresses = makeContext([{ categoryIds: [DRESS] }])
    const dresses = await getStorefrontCategoryTree(makeContainer(), withinDresses, treeQuery())
    expect(dresses.tree.map((node) => node.id)).toEqual([ROOT])
    expect(dresses.tree[0].productCount).toBe(2)
    expect(dresses.tree[0].children.map((node) => node.id)).toEqual([DRESS])
  })

  it('excludes categories an assortment excludes together with their subtree', async () => {
    const scope: EffectiveAssortmentScope = [{ excludeCategoryIds: [ROOT] }]
    const result = await getStorefrontCategoryTree(makeContainer(), makeContext(scope), treeQuery({ includeEmpty: true }))
    expect(result.tree.map((node) => node.id)).toEqual([SHOES])
  })

  it('returns an empty tree without any query for a deny-all assortment', async () => {
    const result = await getStorefrontCategoryTree(makeContainer(), makeContext([]), treeQuery({ includeEmpty: true }))
    expect(result.tree).toEqual([])
    expect(totalQueries()).toBe(0)
  })

  it('drops empty categories unless includeEmpty is set', async () => {
    const hidden = await getStorefrontCategoryTree(makeContainer(), makeContext(null, 'en'), treeQuery())
    expect(JSON.stringify(hidden.tree)).not.toContain(SKIRT)
    expect(hidden.tree[0].children.map((child) => child.id)).toEqual([DRESS])
    const shown = await getStorefrontCategoryTree(makeContainer(), makeContext(null, 'en'), treeQuery({ includeEmpty: true }))
    const clothing = shown.tree.find((node) => node.id === ROOT)
    expect(clothing?.children.map((child) => child.id)).toEqual([DRESS, SKIRT])
    expect(clothing?.children[1].productCount).toBe(0)
  })

  it('reports null counts and keeps empty categories when the assortment exceeds the universe cap', async () => {
    extraUniverseTotal = 1
    const result = await getStorefrontCategoryTree(makeContainer(), makeContext(null, 'en'), treeQuery())
    expect(counters.assignments).toBe(0)
    expect(engineCalls[0].page?.pageSize).toBe(10_000)
    const clothing = result.tree.find((node) => node.id === ROOT)
    expect(clothing?.productCount).toBeNull()
    expect(clothing?.children.map((child) => [child.id, child.productCount])).toEqual([
      [DRESS, null],
      [SKIRT, null],
    ])
  })

  it('limits the depth, keeping hasChildren on the cut level', async () => {
    const result = await getStorefrontCategoryTree(makeContainer(), makeContext(null, 'en'), treeQuery({ depth: 1 }))
    const clothing = result.tree.find((node) => node.id === ROOT)
    expect(clothing?.children).toEqual([])
    expect(clothing?.hasChildren).toBe(true)
  })

  it('serves a subtree for parentId and an identical empty tree for unknown, hidden or foreign parents', async () => {
    const container = makeContainer()
    const subtree = await getStorefrontCategoryTree(container, makeContext(null, 'en'), treeQuery({ parentId: ROOT }))
    expect(subtree.tree.map((node) => node.id)).toEqual([DRESS])
    const responses = await Promise.all(
      [ARCHIVE, ARCHIVE_CHILD, OTHER_TENANT_CATEGORY, '0b8f3f0e-1d2a-4c5b-8e6f-0000000000ff'].map((parentId) =>
        getStorefrontCategoryTree(container, makeContext(null, 'en'), treeQuery({ parentId })),
      ),
    )
    for (const response of responses) expect(response).toEqual({ tree: [], effectiveLocale: 'en' })
    resetCounters()
    await getStorefrontCategoryTree(container, makeContext(null, 'en'), treeQuery({ parentId: '0b8f3f0e-1d2a-4c5b-8e6f-0000000000ff' }))
    expect(counters).toEqual({ engine: 0, find: 1, assignments: 0, translations: 0 })
    const restricted = await getStorefrontCategoryTree(
      container,
      makeContext([{ categoryIds: [SHOES] }], 'en'),
      treeQuery({ parentId: ROOT }),
    )
    expect(restricted).toEqual({ tree: [], effectiveLocale: 'en' })
  })

  it('falls back from the requested locale to the store default and then to the base field', async () => {
    const result = await getStorefrontCategoryTree(makeContainer(), makeContext(null, 'pl'), treeQuery())
    const dresses = result.tree.find((node) => node.id === ROOT)?.children[0]
    expect(dresses?.name).toBe('Dresses')
    const shoes = result.tree.find((node) => node.id === SHOES)
    expect(shoes).toMatchObject({ name: 'Buty', description: 'English shoes' })
    const english = await getStorefrontCategoryTree(makeContainer(), makeContext(null, 'en'), treeQuery())
    expect(names(english.tree)).toEqual(['Clothing', 'Shoes'])
  })

  it('stays within four queries for the whole tree, in one multi-entity translation query', async () => {
    await getStorefrontCategoryTree(makeContainer(), makeContext(), treeQuery({ includeEmpty: true }))
    expect(counters).toEqual({ engine: 1, find: 1, assignments: 1, translations: 1 })
    expect(totalQueries()).toBeLessThanOrEqual(4)
    expect(mockedTranslations).toHaveBeenCalledTimes(1)
    const requests = mockedTranslations.mock.calls[0][1] as Array<{ entityType: string; entityIds: string[] }>
    expect(requests).toHaveLength(1)
    expect(requests[0].entityType).toBe('catalog:catalog_product_category')
    expect(requests[0].entityIds).toEqual(expect.arrayContaining([ROOT, DRESS, SKIRT, SHOES]))
    expect(mockedTranslations.mock.calls[0][2]).toEqual({ tenantId: TENANT_ID, organizationId: ORGANIZATION_ID })
  })
})

describe('getStorefrontCategoryLanding', () => {
  it('returns the category block with breadcrumb, non-empty children and counts within the assortment', async () => {
    const result = await getStorefrontCategoryLanding(makeContainer(), makeContext(null, 'en'), 'dresses')
    expect(result).toEqual({
      category: {
        id: DRESS,
        name: 'Dresses',
        slug: 'dresses',
        description: 'Dresses description',
        depth: 1,
        parentId: ROOT,
        ancestorIds: [ROOT],
        breadcrumb: [
          { id: ROOT, name: 'Clothing', slug: 'clothing' },
          { id: DRESS, name: 'Dresses', slug: 'dresses' },
        ],
        children: [],
        productCount: 2,
        seo: { title: null, description: null, canonicalUrl: null },
      },
      effectiveLocale: 'en',
    })
    const parent = await getStorefrontCategoryLanding(makeContainer(), makeContext(null, 'en'), 'clothing')
    expect(parent?.category.children).toEqual([{ id: DRESS, name: 'Dresses', slug: 'dresses', productCount: 2 }])
    expect(parent?.category.productCount).toBe(2)
  })

  it('reports null counts on the landing when the assortment exceeds the universe cap', async () => {
    extraUniverseTotal = 1
    const result = await getStorefrontCategoryLanding(makeContainer(), makeContext(null, 'en'), 'clothing')
    expect(result?.category.productCount).toBeNull()
    expect(result?.category.children).toEqual([
      { id: DRESS, name: 'Dresses', slug: 'dresses', productCount: null },
      { id: SKIRT, name: 'Skirts', slug: 'skirts', productCount: null },
    ])
  })

  it('localizes the block through one translation query', async () => {
    resetCounters()
    const result = await getStorefrontCategoryLanding(makeContainer(), makeContext(null, 'pl'), 'dresses')
    expect(result?.category.breadcrumb.map((entry) => entry.name)).toEqual(['Odzież', 'Dresses'])
    expect(counters).toEqual({ engine: 1, find: 1, assignments: 1, translations: 1 })
  })

  it('answers null with the same query cost for nonexistent, hidden, inactive and foreign slugs', async () => {
    const cases: Array<{ slug: string; scope: EffectiveAssortmentScope }> = [
      { slug: 'no-such-category', scope: null },
      { slug: 'secret', scope: null },
      { slug: 'archive', scope: null },
      { slug: 'archived-shoes', scope: null },
      { slug: 'dresses', scope: [{ categoryIds: [SHOES] }] },
      { slug: 'clothing', scope: [{ excludeCategoryIds: [ROOT] }] },
    ]
    const costs: Array<typeof counters> = []
    for (const { slug, scope } of cases) {
      resetCounters()
      const result = await getStorefrontCategoryLanding(makeContainer(), makeContext(scope, 'en'), slug)
      expect(result).toBeNull()
      costs.push({ ...counters })
    }
    const nonexistentCost = costs[0]
    for (const cost of costs.slice(1)) expect(cost.find).toBe(nonexistentCost.find)
    expect(costs.every((cost) => cost.find === 1)).toBe(true)
    expect(costs.every((cost) => cost.engine === 0 && cost.assignments === 0 && cost.translations === 0)).toBe(true)
  })

  it('answers null for every slug when the assortment is deny-all', async () => {
    resetCounters()
    expect(await getStorefrontCategoryLanding(makeContainer(), makeContext([]), 'dresses')).toBeNull()
    expect(await getStorefrontCategoryLanding(makeContainer(), makeContext([]), 'no-such-category')).toBeNull()
    expect(totalQueries()).toBe(0)
  })

  it('counts a restricted buyer\'s landing from their own assortment only', async () => {
    const scope: EffectiveAssortmentScope = [{ categoryIds: [DRESS] }]
    const parent = await getStorefrontCategoryLanding(makeContainer(), makeContext(scope, 'en'), 'clothing')
    expect(parent?.category.productCount).toBe(2)
    const hidden = await getStorefrontCategoryLanding(makeContainer(), makeContext(scope, 'en'), 'shoes')
    expect(hidden).toBeNull()
  })
})
