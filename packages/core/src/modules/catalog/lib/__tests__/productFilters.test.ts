import {
  buildProductFilters,
  catalogProductFilterQuerySchema,
  parseIdList,
  scoreProductSearchRelevance,
  type CatalogProductFilterQuery,
} from '../productFilters'
import * as productsRoute from '../../api/products/route'
import {
  CatalogOffer,
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductTagAssignment,
} from '../../data/entities'
import { buildCustomFieldFiltersFromQuery } from '@open-mercato/shared/lib/crud/custom-fields'

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  buildCustomFieldFiltersFromQuery: jest.fn(),
  extractAllCustomFieldEntries: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/encryption/likeFilterWarning', () => ({
  warnOnEncryptedLikeFilter: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}))

const TENANT_ID = 'tenant-1'
const ORG_ID = 'org-1'
const CATEGORY_ROOT = '22222222-2222-4222-8222-222222222222'
const CATEGORY_CHILD = '44444444-4444-4444-8444-444444444444'
const CATEGORY_GRANDCHILD = '55555555-5555-4555-8555-555555555555'
const CATEGORY_OTHER = '66666666-6666-4666-8666-666666666666'
const CHANNEL_ID = '11111111-1111-4111-8111-111111111111'
const TAG_ID = '33333333-3333-4333-8333-333333333333'

type FindCall = { entity: unknown; where: Record<string, unknown>; options: unknown }

type Fixture = {
  categories?: Array<{ id: string; descendantIds: unknown }>
  assignmentsByCategory?: Record<string, string[]>
  offers?: Array<{ id: string; product: string }>
  tagged?: Array<{ id: string; product: string }>
  searchMatches?: Array<{ id: string }>
}

function createContext(fixture: Fixture) {
  const calls: FindCall[] = []
  const find = jest.fn(async (entity: unknown, where: Record<string, unknown>, options: unknown) => {
    calls.push({ entity, where, options })
    if (entity === CatalogProductCategory) return fixture.categories ?? []
    if (entity === CatalogProductCategoryAssignment) {
      const categoryFilter = where.category as { $in: string[] }
      const assignments = fixture.assignmentsByCategory ?? {}
      return categoryFilter.$in.flatMap((categoryId) =>
        (assignments[categoryId] ?? []).map((productId) => ({ id: `${categoryId}:${productId}`, product: productId })),
      )
    }
    if (entity === CatalogOffer) return fixture.offers ?? []
    if (entity === CatalogProductTagAssignment) return fixture.tagged ?? []
    if (entity === CatalogProduct) return fixture.searchMatches ?? []
    return []
  })
  const em = { fork: () => ({ find }) }
  const container = { resolve: jest.fn().mockReturnValue(em) }
  const ctx = {
    container,
    auth: { tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
  } as unknown as Parameters<typeof buildProductFilters>[1]
  return { ctx, calls, find }
}

function parseQuery(input: Record<string, unknown>): CatalogProductFilterQuery {
  return catalogProductFilterQuerySchema.parse(input)
}

const hierarchyFixture: Fixture = {
  categories: [{ id: CATEGORY_ROOT, descendantIds: [CATEGORY_CHILD, CATEGORY_GRANDCHILD] }],
  assignmentsByCategory: {
    [CATEGORY_ROOT]: ['prod-root'],
    [CATEGORY_CHILD]: ['prod-child'],
    [CATEGORY_GRANDCHILD]: ['prod-grandchild'],
  },
}

describe('catalog lib productFilters', () => {
  beforeEach(() => {
    ;(buildCustomFieldFiltersFromQuery as jest.Mock).mockReset()
    ;(buildCustomFieldFiltersFromQuery as jest.Mock).mockResolvedValue({})
  })

  it('is re-exported unchanged by the admin products route (BC bridge)', () => {
    expect(productsRoute.buildProductFilters).toBe(buildProductFilters)
    expect(productsRoute.parseIdList).toBe(parseIdList)
    expect(productsRoute.scoreProductSearchRelevance).toBe(scoreProductSearchRelevance)
    expect(typeof productsRoute.buildPricingContext).toBe('function')
  })

  it('parses the admin list query shape', () => {
    const parsed = parseQuery({ page: '2', withDeleted: 'true', productType: 'simple' })
    expect(parsed.page).toBe(2)
    expect(parsed.pageSize).toBe(50)
    expect(parsed.withDeleted).toBe(true)
    expect(parsed.productType).toBe('simple')
  })

  it('produces identical filters and queries with the option omitted or disabled', async () => {
    const fixture: Fixture = {
      ...hierarchyFixture,
      offers: [
        { id: 'offer-1', product: 'prod-root' },
        { id: 'offer-2', product: 'prod-child' },
      ],
      tagged: [{ id: 'tag-1', product: 'prod-root' }],
      searchMatches: [{ id: 'prod-root' }, { id: 'prod-child' }],
    }
    const query = parseQuery({
      search: 'widget',
      status: ' active ',
      isActive: 'true',
      configurable: 'false',
      productType: 'simple',
      channelIds: CHANNEL_ID,
      categoryIds: CATEGORY_ROOT,
      tagIds: TAG_ID,
    })

    const omitted = createContext(fixture)
    const disabled = createContext(fixture)
    const filtersOmitted = await buildProductFilters(query, omitted.ctx)
    const filtersDisabled = await buildProductFilters(query, disabled.ctx, { includeCategoryDescendants: false })

    expect(filtersOmitted).toEqual({
      status_entry_id: { $eq: 'active' },
      is_active: true,
      is_configurable: false,
      product_type: { $eq: 'simple' },
      id: { $eq: 'prod-root' },
    })
    expect(filtersDisabled).toEqual(filtersOmitted)
    expect(disabled.calls.map((call) => call.entity)).toEqual(omitted.calls.map((call) => call.entity))
    expect(omitted.calls.some((call) => call.entity === CatalogProductCategory)).toBe(false)
  })

  it('matches only the requested categories when descendant expansion is disabled', async () => {
    const { ctx, calls } = createContext(hierarchyFixture)
    const filters = await buildProductFilters(parseQuery({ categoryIds: CATEGORY_ROOT }), ctx)

    expect(filters.id).toEqual({ $eq: 'prod-root' })
    const assignmentCall = calls.find((call) => call.entity === CatalogProductCategoryAssignment)
    expect(assignmentCall?.where.category).toEqual({ $in: [CATEGORY_ROOT] })
    expect(calls).toHaveLength(1)
  })

  it('expands category filters with descendants in one scoped query when enabled', async () => {
    const { ctx, calls } = createContext(hierarchyFixture)
    const filters = await buildProductFilters(
      parseQuery({ categoryIds: CATEGORY_ROOT }),
      ctx,
      { includeCategoryDescendants: true },
    )

    expect(filters.id).toEqual({ $in: ['prod-root', 'prod-child', 'prod-grandchild'] })
    const categoryCalls = calls.filter((call) => call.entity === CatalogProductCategory)
    expect(categoryCalls).toHaveLength(1)
    expect(categoryCalls[0].where).toEqual({
      id: { $in: [CATEGORY_ROOT] },
      deletedAt: null,
      organizationId: ORG_ID,
      tenantId: TENANT_ID,
    })
    const assignmentCall = calls.find((call) => call.entity === CatalogProductCategoryAssignment)
    expect(assignmentCall?.where.category).toEqual({
      $in: [CATEGORY_ROOT, CATEGORY_CHILD, CATEGORY_GRANDCHILD],
    })
    expect(assignmentCall?.where.tenantId).toBe(TENANT_ID)
    expect(assignmentCall?.where.organizationId).toBe(ORG_ID)
  })

  it('deduplicates overlapping descendants and ignores malformed descendant entries', async () => {
    const { ctx, calls } = createContext({
      categories: [
        { id: CATEGORY_ROOT, descendantIds: [CATEGORY_CHILD, '', 42] },
        { id: CATEGORY_CHILD, descendantIds: [CATEGORY_GRANDCHILD] },
        { id: CATEGORY_OTHER, descendantIds: null },
      ],
      assignmentsByCategory: {},
    })
    await buildProductFilters(
      parseQuery({ categoryIds: `${CATEGORY_ROOT},${CATEGORY_CHILD},${CATEGORY_OTHER}` }),
      ctx,
      { includeCategoryDescendants: true },
    )

    const assignmentCall = calls.find((call) => call.entity === CatalogProductCategoryAssignment)
    expect(assignmentCall?.where.category).toEqual({
      $in: [CATEGORY_ROOT, CATEGORY_CHILD, CATEGORY_OTHER, CATEGORY_GRANDCHILD],
    })
  })

  it('keeps the active-filter-with-no-matches semantics when expansion finds nothing', async () => {
    const { ctx } = createContext({ categories: [], assignmentsByCategory: {} })
    const filters = await buildProductFilters(
      parseQuery({ categoryIds: CATEGORY_ROOT }),
      ctx,
      { includeCategoryDescendants: true },
    )
    expect(filters.id).toEqual({ $eq: '00000000-0000-0000-0000-000000000000' })
  })

  it('skips the expansion query when no category filter is requested', async () => {
    const { ctx, calls } = createContext(hierarchyFixture)
    const filters = await buildProductFilters(parseQuery({ isActive: 'true' }), ctx, {
      includeCategoryDescendants: true,
    })
    expect(filters).toEqual({ is_active: true })
    expect(calls).toHaveLength(0)
  })
})
