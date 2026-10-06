import type { AwilixContainer } from 'awilix'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { AvailabilityItemResult, AvailabilityState } from '@open-mercato/shared/lib/availability'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { sanitizeSearchTerm } from '@open-mercato/shared/lib/query/sanitizeSearchTerm'
import { SortDir, type QueryEngine, type Sort, type Where } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import {
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
  CatalogProductTag,
  CatalogProductTagAssignment,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { CatalogProductType } from '@open-mercato/core/modules/catalog/data/types'
import {
  buildProductFilters,
  scoreProductSearchRelevance,
  type CatalogProductFilterQuery,
} from '@open-mercato/core/modules/catalog/lib/productFilters'
import type {
  EcommercePriceDisplayMode,
  EcommercePriceSortFallback,
  EcommerceStorefrontProductListQuery,
  EcommerceStorefrontProductSort,
} from '../data/validators'
import {
  countStorefrontFacets,
  labelStorefrontCountFacets,
  loadStorefrontFacetSource,
  loadStorefrontProductTypeLabeler,
  readCachedStorefrontCountFacets,
  storefrontAvailabilityFacet,
  storefrontFacetTranslationRequests,
  storefrontFacetVariantIndex,
  storefrontPriceRangeFacet,
  writeCachedStorefrontCountFacets,
  type StorefrontCountFacets,
  type StorefrontFacetSelection,
  type StorefrontFacetSource,
  type StorefrontFacets,
} from './storefrontFacets'
import { buildStorefrontProductScope, composeStorefrontProductFilters, type StorefrontProductScope } from './storefrontProductScope'
import { resolveStorefrontPrices, type StorefrontProductPricing } from './storefrontPricing'
import {
  STOREFRONT_CATEGORY_ENTITY_TYPE,
  STOREFRONT_PRODUCT_ENTITY_TYPE,
  STOREFRONT_TAG_ENTITY_TYPE,
  buildStorefrontListItem,
  isCategoryInAssortment,
  loadStorefrontTranslations,
  localeChain,
  nonEmptyString,
  referenceId,
  resolveStorefrontAvailability,
  storefrontAvailabilityKey,
  stringList,
  toStorefrontAvailability,
  tryResolve,
  type CategoryLineage,
  type CategoryRef,
  type StorefrontAvailability,
  type StorefrontProductListItem,
  type TagRef,
  type TranslationMap,
} from './storefrontCatalogSupport'
import type { StoreContext } from './types'

export { isCategoryInAssortment } from './storefrontCatalogSupport'
export type { StorefrontAvailability, StorefrontProductListItem } from './storefrontCatalogSupport'
export type { StorefrontFacets } from './storefrontFacets'

/** Storefront Public API §6.3: the pre-sort id set that is priced and sorted in memory. */
export const STOREFRONT_PRICE_SORT_CAP = 5000

const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

const LIST_FIELDS = [
  'id',
  'title',
  'subtitle',
  'handle',
  'sku',
  'product_type',
  'is_configurable',
  'default_media_url',
  'created_at',
]

const CANDIDATE_FIELDS = ['id', 'title', 'sku']

const SORT_ORDER: readonly EcommerceStorefrontProductSort[] = [
  'relevance',
  'price_asc',
  'price_desc',
  'title_asc',
  'title_desc',
  'newest',
  'featured',
]

export type StorefrontAppliedFilters = {
  search?: string
  category?: { id: string; slug: string | null; includesDescendants: true }
  tagSlugs?: string[]
  price?: { min: number | null; max: number | null; approximate: boolean }
  options?: Record<string, string[]>
  productType?: CatalogProductType
  availability?: { value: 'in_stock' | 'available'; scope: 'page' }
}

export type StorefrontPriceSortPolicy = {
  cap: number
  fallback: EcommercePriceSortFallback
  capExceeded: boolean
}

export type StorefrontProductListResponse = {
  items: StorefrontProductListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  facets: StorefrontFacets
  effectiveLocale: string
  requestedLocale: string | null
  currencyCode: string
  taxMode: EcommercePriceDisplayMode
  appliedFilters: StorefrontAppliedFilters
  availableSorts: EcommerceStorefrontProductSort[]
  appliedSort: EcommerceStorefrontProductSort
  priceSort: StorefrontPriceSortPolicy
  /** The applied order is not exact — the route emits `X-Sort-Approximate: true` (§6.3). */
  sortApproximate: boolean
  /** A requested price sort was declined by the channel's `'unavailable'` policy — `X-Sort-Unavailable: true`. */
  sortUnavailable: boolean
}

export type ListStorefrontProductsOptions = {
  /** Overrides `STOREFRONT_PRICE_SORT_CAP`; intended for tests. */
  priceSortCap?: number
  date?: Date
}

type ProductRecord = {
  id: string
  title?: string | null
  subtitle?: string | null
  handle?: string | null
  sku?: string | null
  product_type?: string | null
  is_configurable?: unknown
  default_media_url?: string | null
}

type Candidate = { id: string; title: string; sku: string | null }

type Runtime = {
  container: AwilixContainer
  ctx: StoreContext
  em: EntityManager
  queryEngine: QueryEngine
  scope: StorefrontProductScope
  decryptionScope: { tenantId: string; organizationId: string }
  date: Date
}

type ResolvedFilters = {
  extra: Where | null
  universe: Where | null
  selection: StorefrontFacetSelection
  applied: StorefrontAppliedFilters
  searchTerm: string | null
}

type HydratedPage = {
  items: StorefrontProductListItem[]
  availabilityStates: AvailabilityState[]
  translations: Map<string, TranslationMap>
}

type CountFacetState = {
  cached: StorefrontCountFacets | null
  source: StorefrontFacetSource | null
}

const EMPTY_COUNT_FACETS: StorefrontCountFacets = { categories: [], tags: [], options: [], productTypes: [] }

type PagePrefetch = {
  variants?: Map<string, string[]>
  pricing?: Map<string, StorefrontProductPricing>
}

function isPriceSort(sort: EcommerceStorefrontProductSort): boolean {
  return sort === 'price_asc' || sort === 'price_desc'
}

function sqlSortFor(sort: EcommerceStorefrontProductSort): Sort[] {
  switch (sort) {
    case 'title_desc':
      return [{ field: 'title', dir: SortDir.Desc }]
    case 'newest':
    case 'featured':
      return [{ field: 'created_at', dir: SortDir.Desc }]
    default:
      return [{ field: 'title', dir: SortDir.Asc }]
  }
}

async function resolveCategoryFilter(
  runtime: Runtime,
  query: EcommerceStorefrontProductListQuery,
): Promise<{ id: string; slug: string | null } | null> {
  if (!query.categoryId && !query.categorySlug) return null
  const { ctx } = runtime
  const where: FilterQuery<CatalogProductCategory> = {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
    isActive: true,
    ...(query.categoryId ? { id: query.categoryId } : { slug: query.categorySlug }),
  }
  const [category] = await findWithDecryption(
    runtime.em,
    CatalogProductCategory,
    where,
    { fields: ['id', 'slug', 'ancestorIds', 'descendantIds'], limit: 1 },
    runtime.decryptionScope,
  )
  if (!category) return null
  const lineage: CategoryLineage = {
    id: category.id,
    ancestorIds: stringList(category.ancestorIds),
    descendantIds: stringList(category.descendantIds),
  }
  if (!isCategoryInAssortment(lineage, ctx.buyer.assortmentScope)) return null
  return { id: category.id, slug: category.slug ?? null }
}

async function resolveTagFilter(runtime: Runtime, slugs: string[] | undefined): Promise<Array<{ id: string; slug: string }>> {
  if (!slugs?.length) return []
  const { ctx } = runtime
  const tags = await findWithDecryption(
    runtime.em,
    CatalogProductTag,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId, slug: { $in: slugs } },
    { fields: ['id', 'slug'] },
    runtime.decryptionScope,
  )
  const bySlug = new Map(tags.map((tag) => [tag.slug, tag.id]))
  return slugs.flatMap((slug) => {
    const id = bySlug.get(slug)
    return id ? [{ id, slug }] : []
  })
}

async function resolveOptionProductIds(runtime: Runtime, options: Record<string, string[]>): Promise<string[]> {
  const { ctx } = runtime
  const optionValues: Record<string, { $in: string[] }> = {}
  for (const [code, values] of Object.entries(options)) optionValues[code] = { $in: values }
  const where = {
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
    isActive: true,
    optionValues,
  } as FilterQuery<CatalogProductVariant>
  const variants = await findWithDecryption(
    runtime.em,
    CatalogProductVariant,
    where,
    { fields: ['id', 'product'] },
    runtime.decryptionScope,
  )
  return Array.from(new Set(variants.map((variant) => referenceId(variant.product)).filter((id): id is string => !!id)))
}

async function productFilterClause(
  runtime: Runtime,
  filterQuery: Omit<CatalogProductFilterQuery, 'page' | 'pageSize'>,
): Promise<Where | null> {
  const { ctx, container } = runtime
  const crudCtx: CrudCtx = {
    container,
    auth: { sub: 'ecommerce:storefront', tenantId: ctx.tenantId, orgId: ctx.organizationId },
    organizationScope: null,
    selectedOrganizationId: ctx.organizationId,
    organizationIds: [ctx.organizationId],
  }
  const productFilters = await buildProductFilters({ page: 1, pageSize: 1, ...filterQuery }, crudCtx, {
    includeCategoryDescendants: true,
  })
  return Object.keys(productFilters).length ? productFilters : null
}

function andClauses(clauses: Array<Where | null>): Where | null {
  const present = clauses.filter((clause): clause is Where => clause !== null)
  if (present.length === 0) return null
  return present.length === 1 ? present[0] : { $and: present }
}

/**
 * Resolves the listing's filters. `extra` is every product filter AND'ed (composed with the scope
 * by the caller); `universe` is the search clause alone — the facet universe (§5.4), since search
 * is the one filter no facet dimension excludes; `selection` is what the facets cross-exclude.
 */
async function resolveListFilters(
  runtime: Runtime,
  query: EcommerceStorefrontProductListQuery,
): Promise<ResolvedFilters> {
  const applied: StorefrontAppliedFilters = {}
  const searchTerm = sanitizeSearchTerm(query.search)
  const [category, resolvedTags, optionProductIds] = await Promise.all([
    resolveCategoryFilter(runtime, query),
    resolveTagFilter(runtime, query.tagSlugs),
    query.options ? resolveOptionProductIds(runtime, query.options) : Promise.resolve(null),
  ])
  if (searchTerm) applied.search = searchTerm
  if (category) applied.category = { id: category.id, slug: category.slug, includesDescendants: true }
  if (resolvedTags.length) applied.tagSlugs = resolvedTags.map((tag) => tag.slug)
  if (query.productType) applied.productType = query.productType
  if (query.options) applied.options = query.options

  const [searchClause, facetClause] = await Promise.all([
    searchTerm ? productFilterClause(runtime, { search: searchTerm }) : Promise.resolve(null),
    category || resolvedTags.length || query.productType
      ? productFilterClause(runtime, {
          categoryIds: category?.id,
          tagIds: resolvedTags.length ? resolvedTags.map((tag) => tag.id).join(',') : undefined,
          productType: query.productType,
        })
      : Promise.resolve(null),
  ])
  const optionClause: Where | null = optionProductIds
    ? optionProductIds.length
      ? { id: { $in: optionProductIds } }
      : { id: { $eq: NO_MATCH_ID } }
    : null
  return {
    extra: andClauses([searchClause, facetClause, optionClause]),
    universe: searchClause,
    selection: {
      categoryId: category?.id ?? null,
      tagIds: resolvedTags.map((tag) => tag.id),
      productType: query.productType ?? null,
      options: query.options ?? {},
    },
    applied,
    searchTerm: searchTerm || null,
  }
}

async function queryCandidates(
  runtime: Runtime,
  filters: Where,
  sort: Sort[],
  pageSize: number,
): Promise<{ items: Candidate[]; total: number }> {
  const result = await runtime.queryEngine.query<ProductRecord>(E.catalog.catalog_product, {
    tenantId: runtime.scope.tenantId,
    organizationId: runtime.scope.organizationId,
    withDeleted: runtime.scope.withDeleted,
    filters,
    fields: CANDIDATE_FIELDS,
    sort,
    page: { page: 1, pageSize: Math.max(1, pageSize) },
  })
  const items = result.items
    .filter((item) => typeof item.id === 'string')
    .map((item) => ({ id: item.id, title: nonEmptyString(item.title) ?? '', sku: nonEmptyString(item.sku) }))
  return { items, total: result.total }
}

async function queryProductsByIds(runtime: Runtime, ids: string[]): Promise<ProductRecord[]> {
  if (!ids.length) return []
  const result = await runtime.queryEngine.query<ProductRecord>(E.catalog.catalog_product, {
    tenantId: runtime.scope.tenantId,
    organizationId: runtime.scope.organizationId,
    withDeleted: runtime.scope.withDeleted,
    filters: composeStorefrontProductFilters(runtime.scope, { id: { $in: ids } }),
    fields: LIST_FIELDS,
    page: { page: 1, pageSize: ids.length },
  })
  const byId = new Map(result.items.map((item) => [item.id, item]))
  return ids.map((id) => byId.get(id)).filter((item): item is ProductRecord => !!item)
}

async function loadVariantIds(runtime: Runtime, productIds: string[]): Promise<Map<string, string[]>> {
  const byProduct = new Map<string, string[]>()
  if (!productIds.length) return byProduct
  const { ctx } = runtime
  const variants = await findWithDecryption(
    runtime.em,
    CatalogProductVariant,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      isActive: true,
      product: { $in: productIds },
    },
    { fields: ['id', 'product'] },
    runtime.decryptionScope,
  )
  for (const variant of variants) {
    const productId = referenceId(variant.product)
    if (!productId) continue
    const bucket = byProduct.get(productId) ?? []
    bucket.push(variant.id)
    byProduct.set(productId, bucket)
  }
  return byProduct
}

async function loadCategories(
  runtime: Runtime,
  productIds: string[],
): Promise<{ byProduct: Map<string, CategoryRef[]>; categoryIds: string[] }> {
  const byProduct = new Map<string, CategoryRef[]>()
  const { ctx } = runtime
  const assignments = await findWithDecryption(
    runtime.em,
    CatalogProductCategoryAssignment,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId, product: { $in: productIds } },
    { populate: ['category'], orderBy: { position: 'asc' } },
    runtime.decryptionScope,
  )
  const categoryIds = new Set<string>()
  for (const assignment of assignments) {
    const productId = referenceId(assignment.product)
    const category = typeof assignment.category === 'object' ? assignment.category : null
    if (!productId || !category || category.deletedAt || category.isActive === false) continue
    const lineage: CategoryLineage = {
      id: category.id,
      ancestorIds: stringList(category.ancestorIds),
      descendantIds: stringList(category.descendantIds),
    }
    if (!isCategoryInAssortment(lineage, ctx.buyer.assortmentScope)) continue
    const bucket = byProduct.get(productId) ?? []
    if (bucket.some((entry) => entry.id === category.id)) continue
    bucket.push({ id: category.id, name: category.name, slug: category.slug ?? null })
    byProduct.set(productId, bucket)
    categoryIds.add(category.id)
  }
  return { byProduct, categoryIds: Array.from(categoryIds) }
}

async function loadTags(
  runtime: Runtime,
  productIds: string[],
): Promise<{ byProduct: Map<string, TagRef[]>; tagIds: string[] }> {
  const byProduct = new Map<string, TagRef[]>()
  const { ctx } = runtime
  const assignments = await findWithDecryption(
    runtime.em,
    CatalogProductTagAssignment,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId, product: { $in: productIds } },
    { populate: ['tag'] },
    runtime.decryptionScope,
  )
  const tagIds = new Set<string>()
  for (const assignment of assignments) {
    const productId = referenceId(assignment.product)
    const tag = typeof assignment.tag === 'object' ? assignment.tag : null
    if (!productId || !tag) continue
    const bucket = byProduct.get(productId) ?? []
    if (bucket.some((entry) => entry.id === tag.id)) continue
    bucket.push({ id: tag.id, label: tag.label })
    byProduct.set(productId, bucket)
    tagIds.add(tag.id)
  }
  return { byProduct, tagIds: Array.from(tagIds) }
}

type PageAvailability = Map<string, { result: AvailabilityItemResult | null; hideWhenOutOfStock: boolean }>

async function resolvePageAvailability(runtime: Runtime, productIds: string[]): Promise<PageAvailability> {
  const results: PageAvailability = new Map()
  if (!productIds.length) return results
  const targets = productIds.map((productId) => ({ productId, variantId: null }))
  const resolved = await resolveStorefrontAvailability(runtime.container, runtime.ctx, runtime.em, targets)
  for (const target of targets) {
    const entry = resolved.get(storefrontAvailabilityKey(target))
    results.set(target.productId, {
      result: entry?.result ?? null,
      hideWhenOutOfStock: entry?.policy?.hideWhenOutOfStock?.value === true,
    })
  }
  return results
}

const IN_STOCK_STATES: ReadonlySet<AvailabilityState> = new Set(['in_stock', 'low_stock', 'not_tracked'])

function matchesAvailabilityFilter(
  availability: StorefrontAvailability,
  filter: EcommerceStorefrontProductListQuery['availability'],
): boolean {
  if (filter === 'in_stock') return IN_STOCK_STATES.has(availability.state) && availability.canFulfil
  if (filter === 'available') return availability.state !== 'out_of_stock' && availability.canFulfil
  return true
}

/**
 * The page's items. `extraTranslations` (the count facets' overlays) ride on the page's single
 * translation query; `availabilityStates` are the page's states after `hideWhenOutOfStock` and
 * before the `availability=` filter — what the page-scoped availability facet counts (§5.3).
 */
async function hydratePage(
  runtime: Runtime,
  records: ProductRecord[],
  query: EcommerceStorefrontProductListQuery,
  prefetch: PagePrefetch,
  extraTranslations: Array<{ entityType: string; ids: string[] }>,
): Promise<HydratedPage> {
  const { ctx, container } = runtime
  if (!records.length) {
    const translations = extraTranslations.length
      ? await loadStorefrontTranslations(runtime.em, ctx, extraTranslations)
      : new Map<string, TranslationMap>()
    return { items: [], availabilityStates: [], translations }
  }
  const productIds = records.map((record) => record.id)
  const [variantsByProduct, categories, tags] = await Promise.all([
    prefetch.variants ?? loadVariantIds(runtime, productIds),
    loadCategories(runtime, productIds),
    loadTags(runtime, productIds),
  ])
  const [pricing, translations, availability] = await Promise.all([
    prefetch.pricing ??
      resolveStorefrontPrices(
        container,
        ctx,
        productIds.map((productId) => ({ productId, variantIds: variantsByProduct.get(productId) ?? [] })),
        { date: runtime.date },
      ),
    loadStorefrontTranslations(runtime.em, ctx, [
      { entityType: STOREFRONT_PRODUCT_ENTITY_TYPE, ids: productIds },
      { entityType: STOREFRONT_CATEGORY_ENTITY_TYPE, ids: categories.categoryIds },
      { entityType: STOREFRONT_TAG_ENTITY_TYPE, ids: tags.tagIds },
      ...extraTranslations,
    ]),
    resolvePageAvailability(runtime, productIds),
  ])
  const locales = localeChain(ctx)
  const productTranslations = translations.get(STOREFRONT_PRODUCT_ENTITY_TYPE)
  const categoryTranslations = translations.get(STOREFRONT_CATEGORY_ENTITY_TYPE)
  const tagTranslations = translations.get(STOREFRONT_TAG_ENTITY_TYPE)

  const items: StorefrontProductListItem[] = []
  const availabilityStates: AvailabilityState[] = []
  for (const record of records) {
    const productAvailability = availability.get(record.id)
    const storefrontAvailability = toStorefrontAvailability(productAvailability?.result ?? null)
    if (productAvailability?.hideWhenOutOfStock && storefrontAvailability.state === 'out_of_stock') continue
    availabilityStates.push(storefrontAvailability.state)
    if (!matchesAvailabilityFilter(storefrontAvailability, query.availability)) continue
    items.push(
      buildStorefrontListItem(
        {
          id: record.id,
          handle: record.handle,
          title: record.title,
          subtitle: record.subtitle,
          defaultMediaUrl: record.default_media_url,
          productType: record.product_type,
          isConfigurable: record.is_configurable,
        },
        {
          locales,
          overlay: productTranslations?.get(record.id),
          variantCount: variantsByProduct.get(record.id)?.length ?? 0,
          categories: categories.byProduct.get(record.id) ?? [],
          categoryTranslations,
          tags: tags.byProduct.get(record.id) ?? [],
          tagTranslations,
          pricing: pricing.get(record.id),
          availability: storefrontAvailability,
        },
      ),
    )
  }
  return { items, availabilityStates, translations }
}

function pricingAmount(pricing: StorefrontProductPricing | undefined): number | null {
  if (!pricing) return null
  return pricing.price?.amount ?? pricing.priceRange?.min ?? null
}

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * Past the cap with `price_sort_fallback = 'approximate'` (§6.3): each product's lowest list price
 * among the channel default price kind's unscoped rows (no customer, group or user), read on the
 * buyer's `taxMode` side. One query over the default kind's rows; never buyer prices.
 */
async function loadApproximateAmounts(runtime: Runtime): Promise<Map<string, number>> {
  const { ctx } = runtime
  const amounts = new Map<string, number>()
  const priceKindId = ctx.channel?.priceKindId ?? null
  if (!priceKindId) return amounts
  const rows = await findWithDecryption(
    runtime.em,
    CatalogProductPrice,
    {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      priceKind: priceKindId,
      currencyCode: ctx.currencyCode,
      customerId: null,
      customerGroupId: null,
      userId: null,
      userGroupId: null,
    },
    { populate: ['variant'] },
    runtime.decryptionScope,
  )
  const channelId = ctx.channel?.salesChannelId ?? null
  const now = runtime.date
  for (const row of rows) {
    if (row.channelId && row.channelId !== channelId) continue
    if ((row.minQuantity ?? 1) > 1) continue
    if (row.startsAt && row.startsAt > now) continue
    if (row.endsAt && row.endsAt < now) continue
    const productId =
      referenceId(row.product) ?? (row.variant && typeof row.variant === 'object' ? referenceId(row.variant.product) : null)
    if (!productId) continue
    const wanted = parseAmount(ctx.buyer.taxMode === 'gross' ? row.unitPriceGross : row.unitPriceNet)
    const amount = wanted ?? parseAmount(ctx.buyer.taxMode === 'gross' ? row.unitPriceNet : row.unitPriceGross)
    if (amount === null) continue
    const current = amounts.get(productId)
    if (current === undefined || amount < current) amounts.set(productId, amount)
  }
  return amounts
}

function compareAmounts(left: number | null, right: number | null, direction: 1 | -1): number {
  if (left === null && right === null) return 0
  if (left === null) return 1
  if (right === null) return -1
  return (left - right) * direction
}

function rankByRelevance<T extends { title: string; sku: string | null }>(items: T[], searchTerm: string): T[] {
  const needle = searchTerm.toLowerCase()
  return items
    .map((item, index) => ({ item, index, score: scoreProductSearchRelevance(needle, item.title, item.sku) }))
    .sort((left, right) => left.score - right.score || left.item.title.localeCompare(right.item.title) || left.index - right.index)
    .map((entry) => entry.item)
}

function matchesPriceFilter(amount: number | null, query: EcommerceStorefrontProductListQuery): boolean {
  if (amount === null) return false
  if (query.priceMin !== undefined && amount < query.priceMin) return false
  if (query.priceMax !== undefined && amount > query.priceMax) return false
  return true
}

function availableSortsFor(searchTerm: string | null, priceSortsOffered: boolean): EcommerceStorefrontProductSort[] {
  return SORT_ORDER.filter((sort) => {
    if (sort === 'relevance') return !!searchTerm
    if (isPriceSort(sort)) return priceSortsOffered
    return true
  })
}

async function resolveCountFacetState(
  runtime: Runtime,
  query: EcommerceStorefrontProductListQuery,
  universe: Where | null,
): Promise<CountFacetState> {
  const cached = await readCachedStorefrontCountFacets(runtime.container, runtime.ctx, query)
  if (cached) return { cached, source: null }
  const source = await loadStorefrontFacetSource(runtime, composeStorefrontProductFilters(runtime.scope, universe))
  return { cached: null, source }
}

/**
 * `GET /products` listing (Storefront Public API rev 4 §4.1, §5.1, §5.3, §6.3, §7, §8.1, §10).
 *
 * Every product query composes `buildStorefrontProductScope` (§3.3). The filtered set is read as
 * ordered candidates (title, newest and featured order in SQL — `featured` orders by `created_at
 * desc` until merchandising supplies a featured rank). While it is at most
 * `STOREFRONT_PRICE_SORT_CAP` products it is priced for the buyer in one batch: that pricing feeds
 * the price sorts, the price filter, relevance ranking and `facets.priceRange` (the filtered set
 * without the price filter, §5.4) and is reused for the page. Past the cap the channel's
 * `priceSortFallback` decides: `'approximate'` orders, filters and ranges by the channel default
 * price kind's list rows and flags `sortApproximate`, `'unavailable'` withdraws the price sorts from
 * `availableSorts`, applies the default sort instead (`sortUnavailable`), leaves the price filter
 * unapplied and returns `priceRange: null`. `availability=` and `hideWhenOutOfStock` are
 * page-scoped (D21): the page is chosen first, then filtered, so `total` counts the
 * pre-availability set and a page may be short; `facets.availability` counts the page.
 *
 * The count facets come from `storefrontFacets` — cached per assortment scope (§9.1); on a miss
 * their universe load also supplies the variant index the pricing reads, and their labels ride on
 * the page's translation query. The whole response, `priceRange` included, is cached by the caller
 * on the full digest.
 */
export async function listStorefrontProducts(
  container: AwilixContainer,
  ctx: StoreContext,
  query: EcommerceStorefrontProductListQuery,
  options: ListStorefrontProductsOptions = {},
): Promise<StorefrontProductListResponse> {
  const em = tryResolve<EntityManager>(container, 'em')
  const queryEngine = tryResolve<QueryEngine>(container, 'queryEngine')
  if (!em || !queryEngine) throw new Error('[internal] ecommerce storefront listing requires em and queryEngine')
  const scope = buildStorefrontProductScope(ctx)
  const runtime: Runtime = {
    container,
    ctx,
    em,
    queryEngine,
    scope,
    decryptionScope: { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
    date: options.date ?? new Date(),
  }
  const cap = Math.max(1, options.priceSortCap ?? STOREFRONT_PRICE_SORT_CAP)
  const fallback: EcommercePriceSortFallback = ctx.channel?.priceSortFallback ?? 'approximate'
  const { page, pageSize } = query

  const { extra, universe, selection, applied, searchTerm } = await resolveListFilters(runtime, query)
  const filters = composeStorefrontProductFilters(scope, extra)
  if (query.availability === 'in_stock' || query.availability === 'available') {
    applied.availability = { value: query.availability, scope: 'page' }
  }

  const defaultSort: EcommerceStorefrontProductSort = searchTerm ? 'relevance' : 'featured'
  const requestedSort = query.sort ?? defaultSort
  const priceSortRequested = isPriceSort(requestedSort)
  const priceFilterRequested = query.priceMin !== undefined || query.priceMax !== undefined
  const baseSort: EcommerceStorefrontProductSort =
    priceSortRequested || requestedSort === 'relevance' ? 'title_asc' : requestedSort

  const [countFacetState, first] = await Promise.all([
    resolveCountFacetState(runtime, query, universe),
    queryCandidates(runtime, filters, sqlSortFor(baseSort), cap),
  ])
  const facetVariants = countFacetState.source ? storefrontFacetVariantIndex(countFacetState.source) : null
  const capExceeded = first.total > cap
  const priceOnOffer = !capExceeded || fallback === 'approximate'

  let sortApproximate = false
  let sortUnavailable = false
  let appliedSort: EcommerceStorefrontProductSort = requestedSort === 'relevance' && !searchTerm ? defaultSort : requestedSort
  let total = 0
  let records: ProductRecord[] = []
  let prefetch: PagePrefetch = {}
  let candidates: Candidate[] | null = null
  let amounts: Map<string, number | null> | null = null

  if (!capExceeded) {
    candidates = first.items
    const candidateIds = candidates.map((candidate) => candidate.id)
    const variants = facetVariants
      ? new Map(candidateIds.map((id) => [id, facetVariants.get(id) ?? []]))
      : await loadVariantIds(runtime, candidateIds)
    const pricing = await resolveStorefrontPrices(
      container,
      ctx,
      candidateIds.map((id) => ({ productId: id, variantIds: variants.get(id) ?? [] })),
      { date: runtime.date },
    )
    prefetch = { variants, pricing }
    amounts = new Map(candidateIds.map((id) => [id, pricingAmount(pricing.get(id))]))
  } else if (priceOnOffer) {
    const [all, approximate] = await Promise.all([
      queryCandidates(runtime, filters, sqlSortFor(baseSort), first.total),
      loadApproximateAmounts(runtime),
    ])
    amounts = new Map(all.items.map((candidate) => [candidate.id, approximate.get(candidate.id) ?? null]))
    if (priceSortRequested || priceFilterRequested) candidates = all.items
  }
  const priceRange = amounts ? storefrontPriceRangeFacet(amounts.values(), ctx.currencyCode) : null

  if (priceFilterRequested && priceOnOffer) {
    applied.price = { min: query.priceMin ?? null, max: query.priceMax ?? null, approximate: capExceeded }
  }
  if (priceSortRequested && !priceOnOffer) {
    sortUnavailable = true
    appliedSort = defaultSort
  }

  if (candidates) {
    let ordered = priceFilterRequested && priceOnOffer
      ? candidates.filter((candidate) => matchesPriceFilter(amounts?.get(candidate.id) ?? null, query))
      : candidates
    if (appliedSort === 'relevance' && searchTerm) {
      ordered = rankByRelevance(ordered, searchTerm)
    } else if (isPriceSort(appliedSort)) {
      const direction = appliedSort === 'price_asc' ? 1 : -1
      ordered = ordered
        .map((candidate, index) => ({ candidate, index }))
        .sort(
          (left, right) =>
            compareAmounts(amounts?.get(left.candidate.id) ?? null, amounts?.get(right.candidate.id) ?? null, direction) ||
            left.index - right.index,
        )
        .map((entry) => entry.candidate)
      sortApproximate = capExceeded
    }
    total = ordered.length
    const pageIds = ordered.slice((page - 1) * pageSize, page * pageSize).map((candidate) => candidate.id)
    records = await queryProductsByIds(runtime, pageIds)
  } else {
    const sqlOrder: EcommerceStorefrontProductSort = appliedSort === 'relevance' ? 'title_asc' : appliedSort
    const result = await runtime.queryEngine.query<ProductRecord>(E.catalog.catalog_product, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      withDeleted: scope.withDeleted,
      filters,
      fields: LIST_FIELDS,
      sort: sqlSortFor(sqlOrder),
      page: { page, pageSize },
    })
    total = result.total
    records = result.items.filter((item) => typeof item.id === 'string')
    if (appliedSort === 'relevance' && searchTerm) {
      records = rankByRelevance(
        records.map((record) => ({ record, title: nonEmptyString(record.title) ?? '', sku: nonEmptyString(record.sku) })),
        searchTerm,
      ).map((entry) => entry.record)
      sortApproximate = true
    }
    if (facetVariants) prefetch = { variants: new Map(records.map((record) => [record.id, facetVariants.get(record.id) ?? []])) }
  }

  const availableSorts = availableSortsFor(searchTerm, !(capExceeded && fallback === 'unavailable'))
  const { source, cached } = countFacetState
  const rawCounts = source ? countStorefrontFacets(source, selection) : null
  const hydrated = await hydratePage(
    runtime,
    records,
    query,
    prefetch,
    source && rawCounts ? storefrontFacetTranslationRequests(source, rawCounts) : [],
  )
  let countFacets: StorefrontCountFacets = cached ?? EMPTY_COUNT_FACETS
  if (source && rawCounts) {
    countFacets = labelStorefrontCountFacets(source, rawCounts, {
      locales: localeChain(ctx),
      translations: hydrated.translations,
      assortmentScope: ctx.buyer.assortmentScope,
      productTypeLabel: await loadStorefrontProductTypeLabeler(ctx.effectiveLocale),
    })
    await writeCachedStorefrontCountFacets(container, ctx, query, countFacets, selection)
  }
  const facets: StorefrontFacets = {
    categories: countFacets.categories,
    tags: countFacets.tags,
    priceRange,
    options: countFacets.options,
    productTypes: countFacets.productTypes,
    availability: storefrontAvailabilityFacet(hydrated.availabilityStates),
    availabilityScope: 'page',
    total,
  }

  return {
    items: hydrated.items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    facets,
    effectiveLocale: ctx.effectiveLocale,
    requestedLocale: ctx.requestedLocale,
    currencyCode: ctx.currencyCode,
    taxMode: ctx.buyer.taxMode,
    appliedFilters: applied,
    availableSorts,
    appliedSort,
    priceSort: { cap, fallback, capExceeded },
    sortApproximate,
    sortUnavailable,
  }
}
