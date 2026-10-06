import type { AwilixContainer } from 'awilix'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import {
  availabilityItemKey,
  resolveAvailability,
  type AvailabilityItemResult,
  type AvailabilityModuleConfigReader,
  type AvailabilityState,
} from '@open-mercato/shared/lib/availability'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import type { AssortmentScope, EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { sanitizeSearchTerm } from '@open-mercato/shared/lib/query/sanitizeSearchTerm'
import { SortDir, type QueryEngine, type Sort, type Where } from '@open-mercato/shared/lib/query/types'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
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
import { batchLoadTranslations } from '@open-mercato/core/modules/translations/lib/batch'
import type {
  EcommercePriceDisplayMode,
  EcommercePriceSortFallback,
  EcommerceStorefrontProductListQuery,
  EcommerceStorefrontProductSort,
} from '../data/validators'
import { buildStorefrontProductScope, composeStorefrontProductFilters, type StorefrontProductScope } from './storefrontProductScope'
import {
  resolveStorefrontPrices,
  type StorefrontPrice,
  type StorefrontPriceRange,
  type StorefrontProductPricing,
} from './storefrontPricing'
import type { StoreContext } from './types'

const logger = createLogger('ecommerce')

/** Storefront Public API §6.3: the pre-sort id set that is priced and sorted in memory. */
export const STOREFRONT_PRICE_SORT_CAP = 5000

const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

const PRODUCT_ENTITY_TYPE = 'catalog:catalog_product'
const CATEGORY_ENTITY_TYPE = 'catalog:catalog_product_category'
const TAG_ENTITY_TYPE = 'catalog:catalog_product_tag'

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

export type StorefrontAvailability = {
  state: AvailabilityState
  canFulfil: boolean
  leadTimeDays: number | null
  releaseAt: string | null
}

export type StorefrontProductListItem = {
  id: string
  handle: string | null
  title: string
  subtitle: string | null
  defaultMediaUrl: string | null
  productType: string
  isConfigurable: boolean
  hasVariants: boolean
  variantCount: number
  categories: Array<{ id: string; name: string; slug: string | null }>
  tags: string[]
  price: StorefrontPrice | null
  priceRange: StorefrontPriceRange | null
  availability: StorefrontAvailability
  badges: string[]
}

export type StorefrontFacets = {
  categories: Array<{ id: string; name: string; slug: string | null; depth: number; parentId: string | null; count: number }>
  tags: Array<{ slug: string; label: string; count: number }>
  priceRange: { min: number; max: number; currencyCode: string } | null
  options: Array<{ code: string; label: string; values: Array<{ code: string; label: string; count: number }> }>
  productTypes: Array<{ type: string; label: string; count: number }>
  availability: Array<{ state: AvailabilityState; count: number }>
  availabilityScope: 'page'
  total: number
}

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

type CategoryLineage = { id: string; ancestorIds: string[]; descendantIds: string[] }

type CategoryRef = { id: string; name: string; slug: string | null }

type TagRef = { id: string; label: string }

type TranslationMap = Map<string, Record<string, Record<string, unknown>>>

type PolicyResolutionScope = {
  tenantId: string
  organizationId: string
  storeId: string | null
  productId: string
  variantId: string | null
}

type StorefrontPolicyResolver = {
  resolveMany(
    em: EntityManager,
    scopes: PolicyResolutionScope[],
  ): Promise<Array<{ hideWhenOutOfStock: { value: boolean } } | null | undefined>>
}

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
  applied: StorefrontAppliedFilters
  searchTerm: string | null
}

type PagePrefetch = {
  variants?: Map<string, string[]>
  pricing?: Map<string, StorefrontProductPricing>
}

function tryResolve<T>(container: AwilixContainer, name: string): T | null {
  try {
    return (container.resolve(name) as T | null | undefined) ?? null
  } catch {
    return null
  }
}

function referenceId(value: unknown): string | null {
  if (typeof value === 'string') return value.length ? value : null
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id: unknown }).id
    return typeof id === 'string' && id.length ? id : null
  }
  return null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : []
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
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

function categoryBranchAdmits(branch: AssortmentScope, lineage: Set<string>, reach: Set<string>): boolean {
  const included = stringList(branch.categoryIds)
  if (included.length > 0 && !included.some((id) => reach.has(id))) return false
  if (stringList(branch.excludeCategoryIds).some((id) => lineage.has(id))) return false
  return (branch.allOf ?? []).every((nested) => categoryBranchAdmits(nested, lineage, reach))
}

/**
 * Whether a category can hold any product the effective assortment admits: one of its own subtree
 * or ancestors is granted by some branch, and neither it nor an ancestor is excluded there. Tag and
 * product conditions are product-level and do not decide a category's visibility.
 */
export function isCategoryInAssortment(category: CategoryLineage, scope: EffectiveAssortmentScope): boolean {
  if (scope === null) return true
  const lineage = new Set([category.id, ...category.ancestorIds])
  const reach = new Set([...lineage, ...category.descendantIds])
  return scope.some((branch) => categoryBranchAdmits(branch, lineage, reach))
}

function localize(
  base: unknown,
  translations: Record<string, Record<string, unknown>> | undefined,
  field: string,
  locales: string[],
): string | null {
  for (const locale of locales) {
    const value = nonEmptyString(translations?.[locale]?.[field])
    if (value !== null) return value
  }
  return nonEmptyString(base)
}

function localeChain(ctx: StoreContext): string[] {
  return Array.from(new Set([ctx.effectiveLocale, ctx.store.defaultLocale].filter((locale) => !!locale)))
}

async function loadTranslations(
  runtime: Runtime,
  requests: Array<{ entityType: string; ids: string[] }>,
): Promise<Map<string, TranslationMap>> {
  const results = new Map<string, TranslationMap>()
  const pending = requests.filter((request) => request.ids.length > 0)
  if (!pending.length) return results
  const { ctx } = runtime
  try {
    const db = runtime.em.getKysely()
    const maps = await Promise.all(
      pending.map((request) =>
        batchLoadTranslations(db, request.entityType, request.ids, {
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
        }),
      ),
    )
    pending.forEach((request, index) => results.set(request.entityType, maps[index]))
  } catch (err) {
    logger.error('[internal] ecommerce storefront translation overlay failed', {
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      storeId: ctx.store.id,
      err,
    })
    getTelemetryRuntime()?.reportError(err, {
      module: 'ecommerce',
      code: 'ecommerce.storefront_translations_failed',
      attributes: { entityTypes: pending.length },
    })
    results.clear()
  }
  return results
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

async function resolveListFilters(
  runtime: Runtime,
  query: EcommerceStorefrontProductListQuery,
): Promise<ResolvedFilters> {
  const { ctx, container } = runtime
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

  const clauses: Where[] = []
  if (searchTerm || category || resolvedTags.length || query.productType) {
    const filterQuery: CatalogProductFilterQuery = {
      page: 1,
      pageSize: 1,
      search: searchTerm || undefined,
      categoryIds: category?.id,
      tagIds: resolvedTags.length ? resolvedTags.map((tag) => tag.id).join(',') : undefined,
      productType: query.productType,
    }
    const crudCtx: CrudCtx = {
      container,
      auth: { sub: 'ecommerce:storefront', tenantId: ctx.tenantId, orgId: ctx.organizationId },
      organizationScope: null,
      selectedOrganizationId: ctx.organizationId,
      organizationIds: [ctx.organizationId],
    }
    const productFilters = await buildProductFilters(filterQuery, crudCtx, { includeCategoryDescendants: true })
    if (Object.keys(productFilters).length) clauses.push(productFilters)
  }
  if (optionProductIds) {
    clauses.push(optionProductIds.length ? { id: { $in: optionProductIds } } : { id: { $eq: NO_MATCH_ID } })
  }
  const extra: Where | null = clauses.length === 0 ? null : clauses.length === 1 ? clauses[0] : { $and: clauses }
  return { extra, applied, searchTerm: searchTerm || null }
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
  const { ctx, container, em } = runtime
  const results: PageAvailability = new Map()
  if (!productIds.length) return results
  const items = productIds.map((productId) => ({ catalogProductId: productId, catalogVariantId: null, quantity: 1 }))
  const moduleConfig = tryResolve<AvailabilityModuleConfigReader>(container, 'moduleConfigService')
  const policyResolver = tryResolve<StorefrontPolicyResolver>(container, 'policyResolutionService')
  const [availability, policies] = await Promise.all([
    resolveAvailability(
      {
        tenantId: ctx.tenantId,
        organizationId: ctx.organizationId,
        storeId: ctx.store.id,
        channelId: ctx.channel?.salesChannelId ?? null,
        items,
      },
      moduleConfig ? { moduleConfig, container } : { container },
    ),
    policyResolver
      ? policyResolver.resolveMany(
          em,
          productIds.map((productId) => ({
            tenantId: ctx.tenantId,
            organizationId: ctx.organizationId,
            storeId: ctx.store.id,
            productId,
            variantId: null,
          })),
        )
      : Promise.resolve([]),
  ])
  productIds.forEach((productId, index) => {
    results.set(productId, {
      result: availability.byItem[availabilityItemKey({ catalogProductId: productId, catalogVariantId: null })] ?? null,
      hideWhenOutOfStock: policies[index]?.hideWhenOutOfStock?.value === true,
    })
  })
  return results
}

function toStorefrontAvailability(result: AvailabilityItemResult | null): StorefrontAvailability {
  if (!result) return { state: 'not_tracked', canFulfil: true, leadTimeDays: null, releaseAt: null }
  return {
    state: result.state,
    canFulfil: result.canFulfil,
    leadTimeDays: result.leadTimeDays,
    releaseAt: result.releaseAt,
  }
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

async function hydratePage(
  runtime: Runtime,
  records: ProductRecord[],
  query: EcommerceStorefrontProductListQuery,
  prefetch: PagePrefetch,
): Promise<StorefrontProductListItem[]> {
  if (!records.length) return []
  const { ctx, container } = runtime
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
    loadTranslations(runtime, [
      { entityType: PRODUCT_ENTITY_TYPE, ids: productIds },
      { entityType: CATEGORY_ENTITY_TYPE, ids: categories.categoryIds },
      { entityType: TAG_ENTITY_TYPE, ids: tags.tagIds },
    ]),
    resolvePageAvailability(runtime, productIds),
  ])
  const locales = localeChain(ctx)
  const productTranslations = translations.get(PRODUCT_ENTITY_TYPE)
  const categoryTranslations = translations.get(CATEGORY_ENTITY_TYPE)
  const tagTranslations = translations.get(TAG_ENTITY_TYPE)

  const items: StorefrontProductListItem[] = []
  for (const record of records) {
    const productAvailability = availability.get(record.id)
    const storefrontAvailability = toStorefrontAvailability(productAvailability?.result ?? null)
    if (productAvailability?.hideWhenOutOfStock && storefrontAvailability.state === 'out_of_stock') continue
    if (!matchesAvailabilityFilter(storefrontAvailability, query.availability)) continue
    const overlay = productTranslations?.get(record.id)
    const productPricing = pricing.get(record.id)
    const variantCount = variantsByProduct.get(record.id)?.length ?? 0
    const price = productPricing?.price ?? null
    items.push({
      id: record.id,
      handle: nonEmptyString(record.handle),
      title: localize(record.title, overlay, 'title', locales) ?? '',
      subtitle: localize(record.subtitle, overlay, 'subtitle', locales),
      defaultMediaUrl: nonEmptyString(record.default_media_url),
      productType: nonEmptyString(record.product_type) ?? 'simple',
      isConfigurable: parseBooleanFromUnknown(record.is_configurable) === true,
      hasVariants: variantCount > 0,
      variantCount,
      categories: (categories.byProduct.get(record.id) ?? []).map((category) => ({
        id: category.id,
        name: localize(category.name, categoryTranslations?.get(category.id), 'name', locales) ?? category.name,
        slug: category.slug,
      })),
      tags: (tags.byProduct.get(record.id) ?? []).map(
        (tag) => localize(tag.label, tagTranslations?.get(tag.id), 'label', locales) ?? tag.label,
      ),
      price,
      priceRange: productPricing?.priceRange ?? null,
      availability: storefrontAvailability,
      badges: price?.isPromotion ? ['sale'] : [],
    })
  }
  return items
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

function emptyFacets(total: number): StorefrontFacets {
  return {
    categories: [],
    tags: [],
    priceRange: null,
    options: [],
    productTypes: [],
    availability: [],
    availabilityScope: 'page',
    total,
  }
}

function availableSortsFor(searchTerm: string | null, priceSortsOffered: boolean): EcommerceStorefrontProductSort[] {
  return SORT_ORDER.filter((sort) => {
    if (sort === 'relevance') return !!searchTerm
    if (isPriceSort(sort)) return priceSortsOffered
    return true
  })
}

/**
 * `GET /products` listing (Storefront Public API rev 4 §4.1, §5.1, §6.3, §7, §8.1, §10).
 *
 * Every product query composes `buildStorefrontProductScope` (§3.3). Title, newest and featured
 * order in SQL — `featured` orders by `created_at desc` until merchandising supplies a featured rank.
 * Price sorts, buyer-price filters and relevance rank the filtered id set in memory while it is at
 * most `STOREFRONT_PRICE_SORT_CAP` products; past it the channel's `priceSortFallback` decides:
 * `'approximate'` orders and filters by the channel default price kind's list rows and flags
 * `sortApproximate`, `'unavailable'` withdraws the price sorts from `availableSorts`, applies the
 * default sort instead (`sortUnavailable`) and leaves the price filter unapplied. `availability=` and
 * `hideWhenOutOfStock` are page-scoped (D21): the page is chosen first, then filtered, so `total`
 * counts the pre-availability set and a page may be short. Facets are not computed yet (Phase 2) —
 * `facets` carries the empty shape.
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

  const { extra, applied, searchTerm } = await resolveListFilters(runtime, query)
  const filters = composeStorefrontProductFilters(scope, extra)
  if (query.availability === 'in_stock' || query.availability === 'available') {
    applied.availability = { value: query.availability, scope: 'page' }
  }

  const defaultSort: EcommerceStorefrontProductSort = searchTerm ? 'relevance' : 'featured'
  const requestedSort = query.sort ?? defaultSort
  const priceSortRequested = isPriceSort(requestedSort)
  const priceFilterRequested = query.priceMin !== undefined || query.priceMax !== undefined
  const relevanceRequested = requestedSort === 'relevance' && !!searchTerm
  const baseSort: EcommerceStorefrontProductSort =
    priceSortRequested || requestedSort === 'relevance' ? 'title_asc' : requestedSort

  let capExceeded = false
  let sortApproximate = false
  let sortUnavailable = false
  let appliedSort: EcommerceStorefrontProductSort = requestedSort === 'relevance' && !searchTerm ? defaultSort : requestedSort
  let total = 0
  let records: ProductRecord[] = []
  let prefetch: PagePrefetch = {}
  let inMemory = false

  if (priceSortRequested || priceFilterRequested || relevanceRequested) {
    const first = await queryCandidates(runtime, filters, sqlSortFor(baseSort), cap)
    capExceeded = first.total > cap
    const priceOnOffer = !capExceeded || fallback === 'approximate'
    const priceNeeded = priceOnOffer && (priceSortRequested || priceFilterRequested)
    let candidates: Candidate[] | null = null
    let amounts = new Map<string, number | null>()
    if (!capExceeded) {
      candidates = first.items
      if (priceNeeded) {
        const variants = await loadVariantIds(runtime, candidates.map((candidate) => candidate.id))
        const pricing = await resolveStorefrontPrices(
          container,
          ctx,
          candidates.map((candidate) => ({ productId: candidate.id, variantIds: variants.get(candidate.id) ?? [] })),
          { date: runtime.date },
        )
        prefetch = { variants, pricing }
        amounts = new Map(candidates.map((candidate) => [candidate.id, pricingAmount(pricing.get(candidate.id))]))
      }
    } else if (priceNeeded) {
      const [all, approximate] = await Promise.all([
        queryCandidates(runtime, filters, sqlSortFor(baseSort), first.total),
        loadApproximateAmounts(runtime),
      ])
      candidates = all.items
      amounts = new Map(candidates.map((candidate) => [candidate.id, approximate.get(candidate.id) ?? null]))
    }

    if (priceFilterRequested && priceNeeded) {
      applied.price = { min: query.priceMin ?? null, max: query.priceMax ?? null, approximate: capExceeded }
    }
    if (priceSortRequested && !priceOnOffer) {
      sortUnavailable = true
      appliedSort = defaultSort
    }

    if (candidates) {
      inMemory = true
      let ordered = priceFilterRequested && priceNeeded
        ? candidates.filter((candidate) => matchesPriceFilter(amounts.get(candidate.id) ?? null, query))
        : candidates
      if (appliedSort === 'relevance' && searchTerm) {
        ordered = rankByRelevance(ordered, searchTerm)
      } else if (isPriceSort(appliedSort)) {
        const direction = appliedSort === 'price_asc' ? 1 : -1
        ordered = ordered
          .map((candidate, index) => ({ candidate, index }))
          .sort(
            (left, right) =>
              compareAmounts(amounts.get(left.candidate.id) ?? null, amounts.get(right.candidate.id) ?? null, direction) ||
              left.index - right.index,
          )
          .map((entry) => entry.candidate)
        sortApproximate = capExceeded
      }
      total = ordered.length
      const pageIds = ordered.slice((page - 1) * pageSize, page * pageSize).map((candidate) => candidate.id)
      records = await queryProductsByIds(runtime, pageIds)
    }
  }

  if (!inMemory) {
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
    capExceeded = capExceeded || total > cap
    records = result.items.filter((item) => typeof item.id === 'string')
    if (appliedSort === 'relevance' && searchTerm) {
      records = rankByRelevance(
        records.map((record) => ({ record, title: nonEmptyString(record.title) ?? '', sku: nonEmptyString(record.sku) })),
        searchTerm,
      ).map((entry) => entry.record)
      sortApproximate = true
    }
  }

  const availableSorts = availableSortsFor(searchTerm, !(capExceeded && fallback === 'unavailable'))
  const items = await hydratePage(runtime, records, query, prefetch)

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    facets: emptyFacets(total),
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
