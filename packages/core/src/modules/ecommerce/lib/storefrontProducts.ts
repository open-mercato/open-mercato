import type { EntityManager } from '@mikro-orm/postgresql'
import {
  CatalogProduct,
  CatalogProductVariant,
  CatalogProductPrice,
  CatalogProductCategoryAssignment,
  CatalogProductTagAssignment,
  CatalogProductTag,
  CatalogProductCategory,
  CatalogOffer,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { CatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import type { PriceRow } from '@open-mercato/core/modules/catalog/lib/pricing'
import { resolvePriceKindCode } from '@open-mercato/core/modules/catalog/lib/pricing'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { StoreContext } from './storeContext'

export function filterByPriceKind(prices: PriceRow[], priceKindId: string | null | undefined): PriceRow[] {
  if (!priceKindId) return prices
  const filtered = prices.filter((p) => {
    const kindId = typeof p.priceKind === 'object' && p.priceKind ? (p.priceKind as { id?: string }).id : null
    return kindId === priceKindId
  })
  return filtered.length > 0 ? filtered : prices
}

export type StorefrontProductsQuery = {
  page: number
  pageSize: number
  search?: string | null
  categoryId?: string | null
  tagIds?: string[] | null
  priceMin?: number | null
  priceMax?: number | null
  sort?: string | null
}

export type StorefrontProductItem = {
  id: string
  handle: string | null
  title: string
  subtitle: string | null
  defaultMediaUrl: string | null
  productType: string
  isConfigurable: boolean
  categories: Array<{ id: string; name: string; slug: string | null }>
  tags: string[]
  priceRange: { min: string; max: string; currencyCode: string } | null
  hasVariants: boolean
  variantCount: number
}

export type StorefrontFacets = {
  categories: Array<{ id: string; name: string; slug: string | null; count: number }>
  tags: Array<{ slug: string; label: string; count: number }>
  priceRange: { min: number; max: number; currencyCode: string } | null
  options: Array<{ code: string; label: string; values: Array<{ code: string; label: string; count: number }> }>
}

export type StorefrontProductsResult = {
  items: StorefrontProductItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  effectiveLocale: string
  filters: StorefrontFacets
}

type PricingContext = {
  channelId?: string | null
  quantity: number
  date: Date
}

function buildPricingContext(storeCtx: StoreContext): PricingContext {
  return {
    channelId: storeCtx.channelBinding?.salesChannelId ?? null,
    quantity: 1,
    date: new Date(),
  }
}

function resolveLocalizedTitle(
  product: { title: string },
  offer: CatalogOffer | null,
  locale: string,
): string {
  if (offer?.localizedContent) {
    const locContent = offer.localizedContent[locale]
    if (locContent?.title) return locContent.title
    const lang = locale.split('-')[0]
    const fallbackKey = Object.keys(offer.localizedContent).find((k) => k.startsWith(lang))
    if (fallbackKey && offer.localizedContent[fallbackKey]?.title) {
      return offer.localizedContent[fallbackKey].title!
    }
    if (offer.title) return offer.title
  }
  return product.title
}

function resolveLocalizedSubtitle(
  product: { subtitle?: string | null },
  offer: CatalogOffer | null,
  locale: string,
): string | null {
  if (offer?.localizedContent) {
    const locContent = offer.localizedContent[locale]
    if (locContent?.description) return locContent.description
  }
  return product.subtitle ?? null
}

type ChannelScope = {
  includedIds: string[] | null
  excludedIds: string[]
}

async function resolveChannelScope(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
  scope: Record<string, unknown> | null,
): Promise<ChannelScope | null> {
  if (!scope) return null

  const categoryIds = Array.isArray(scope.categoryIds)
    ? (scope.categoryIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  const tagIds = Array.isArray(scope.tagIds)
    ? (scope.tagIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []
  const excludedIds = Array.isArray(scope.excludeProductIds)
    ? (scope.excludeProductIds as unknown[]).filter((id): id is string => typeof id === 'string')
    : []

  if (categoryIds.length === 0 && tagIds.length === 0 && excludedIds.length === 0) {
    return null
  }

  const sets: Set<string>[] = []

  if (categoryIds.length > 0) {
    const assignments = await em.find(
      CatalogProductCategoryAssignment,
      { category: { $in: categoryIds }, organizationId, tenantId },
      { fields: ['product'] },
    )
    const ids = assignments
      .map((a) => (typeof a.product === 'string' ? a.product : a.product?.id ?? null))
      .filter((id): id is string => !!id)
    sets.push(new Set(ids))
  }

  if (tagIds.length > 0) {
    const assignments = await em.find(
      CatalogProductTagAssignment,
      { tag: { $in: tagIds }, organizationId, tenantId },
      { fields: ['product'] },
    )
    const ids = assignments
      .map((a) => (typeof a.product === 'string' ? a.product : a.product?.id ?? null))
      .filter((id): id is string => !!id)
    sets.push(new Set(ids))
  }

  let includedIds: string[] | null = null
  if (sets.length > 0) {
    let result = sets[0]
    for (let i = 1; i < sets.length; i++) {
      result = new Set(Array.from(result).filter((id) => sets[i].has(id)))
    }
    includedIds = Array.from(result)
  }

  return { includedIds, excludedIds }
}

async function resolveProductIds(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
  query: StorefrontProductsQuery,
): Promise<string[] | null> {
  const sets: Set<string>[] = []

  if (query.categoryId) {
    const category = await em.findOne(CatalogProductCategory, {
      id: query.categoryId,
      organizationId,
      tenantId,
      deletedAt: null,
    })
    if (!category) return []

    const categoryIds = [category.id, ...category.descendantIds]
    const assignments = await em.find(
      CatalogProductCategoryAssignment,
      { category: { $in: categoryIds }, organizationId, tenantId },
      { fields: ['product'] },
    )
    const ids = assignments
      .map((a) => (typeof a.product === 'string' ? a.product : a.product?.id ?? null))
      .filter((id): id is string => !!id)
    sets.push(new Set(ids))
  }

  if (query.tagIds && query.tagIds.length > 0) {
    const assignments = await em.find(
      CatalogProductTagAssignment,
      { tag: { $in: query.tagIds }, organizationId, tenantId },
      { fields: ['product'] },
    )
    const ids = assignments
      .map((a) => (typeof a.product === 'string' ? a.product : a.product?.id ?? null))
      .filter((id): id is string => !!id)
    sets.push(new Set(ids))
  }

  if (sets.length === 0) return null

  let result = sets[0]
  for (let i = 1; i < sets.length; i++) {
    result = new Set(Array.from(result).filter((id) => sets[i].has(id)))
  }
  return Array.from(result)
}

function buildOrderBy(sort: string | null | undefined): Record<string, 'asc' | 'desc'> {
  switch (sort) {
    case 'title_asc':
      return { title: 'asc' }
    case 'title_desc':
      return { title: 'desc' }
    case 'newest':
      return { createdAt: 'desc' }
    default:
      return { createdAt: 'desc' }
  }
}

function computePriceRange(
  prices: Array<{ unitPriceGross?: string | null; unitPriceNet?: string | null; currencyCode: string }>,
): { min: string; max: string; currencyCode: string } | null {
  const values = prices
    .map((p) => {
      const val = p.unitPriceGross ?? p.unitPriceNet
      return val ? { amount: parseFloat(val), currency: p.currencyCode } : null
    })
    .filter((v): v is { amount: number; currency: string } => v !== null && !isNaN(v.amount))

  if (!values.length) return null

  values.sort((a, b) => a.amount - b.amount)
  const min = values[0]
  const max = values[values.length - 1]

  return {
    min: min.amount.toFixed(4),
    max: max.amount.toFixed(4),
    currencyCode: min.currency,
  }
}

export async function fetchStorefrontProducts(
  em: EntityManager,
  pricingService: CatalogPricingService,
  storeCtx: StoreContext,
  query: StorefrontProductsQuery,
): Promise<StorefrontProductsResult> {
  const { organizationId, tenantId, effectiveLocale } = storeCtx
  const page = Math.max(1, query.page)
  const pageSize = Math.min(100, Math.max(1, query.pageSize))
  const offset = (page - 1) * pageSize

  const [queryRestrictedIds, channelScope] = await Promise.all([
    resolveProductIds(em, organizationId, tenantId, query),
    resolveChannelScope(em, organizationId, tenantId, storeCtx.channelBinding?.catalogScope ?? null),
  ])

  // Intersect user query restriction with channel scope inclusion
  let restrictedIds: string[] | null = queryRestrictedIds
  if (channelScope?.includedIds !== null && channelScope?.includedIds !== undefined) {
    const channelSet = new Set(channelScope.includedIds)
    if (restrictedIds !== null) {
      restrictedIds = restrictedIds.filter((id) => channelSet.has(id))
    } else {
      restrictedIds = channelScope.includedIds
    }
  }

  if (restrictedIds !== null && restrictedIds.length === 0) {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
      totalPages: 0,
      effectiveLocale,
      filters: { categories: [], tags: [], priceRange: null, options: [] },
    }
  }

  const baseWhere: Record<string, unknown> = {
    organizationId,
    tenantId,
    isActive: true,
    deletedAt: null,
  }

  if (restrictedIds !== null) {
    baseWhere.id = { $in: restrictedIds }
  }

  // Apply channel scope exclusion
  if (channelScope && channelScope.excludedIds.length > 0) {
    const existingIdFilter = baseWhere.id as Record<string, unknown> | undefined
    if (existingIdFilter && '$in' in existingIdFilter) {
      baseWhere.id = {
        $in: (existingIdFilter.$in as string[]).filter((id) => !channelScope.excludedIds.includes(id)),
      }
    } else {
      baseWhere.id = { ...(existingIdFilter ?? {}), $nin: channelScope.excludedIds }
    }
  }

  if (query.search?.trim()) {
    const like = `%${escapeLikePattern(query.search.trim())}%`
    baseWhere.$or = [
      { title: { $ilike: like } },
      { subtitle: { $ilike: like } },
      { sku: { $ilike: like } },
      { handle: { $ilike: like } },
      { description: { $ilike: like } },
    ]
  }

  const orderBy = buildOrderBy(query.sort)
  const [allMatchingProducts, total] = await Promise.all([
    em.find(CatalogProduct, baseWhere as object, {
      orderBy,
      limit: pageSize,
      offset,
      fields: [
        'id', 'title', 'subtitle', 'handle', 'defaultMediaUrl',
        'productType', 'isConfigurable', 'isActive',
      ],
    }),
    em.count(CatalogProduct, baseWhere as object),
  ])

  const productIds = allMatchingProducts.map((p) => p.id)

  if (productIds.length === 0) {
    const [catFacets, tagFacets] = await Promise.all([
      computeCategoryFacets(em, organizationId, tenantId, []),
      computeTagFacets(em, organizationId, tenantId, []),
    ])
    return {
      items: [],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      effectiveLocale,
      filters: { categories: catFacets, tags: tagFacets, priceRange: null, options: [] },
    }
  }

  const [categoryAssignments, tagAssignments, variants, allPrices, channelOffers] = await Promise.all([
    em.find(
      CatalogProductCategoryAssignment,
      { product: { $in: productIds }, organizationId, tenantId },
      { populate: ['category'] },
    ),
    em.find(
      CatalogProductTagAssignment,
      { product: { $in: productIds }, organizationId, tenantId },
      { populate: ['tag'] },
    ),
    em.find(
      CatalogProductVariant,
      { product: { $in: productIds }, organizationId, tenantId, deletedAt: null, isActive: true },
      { fields: ['id', 'product', 'name', 'sku', 'isDefault'] },
    ),
    em.find(
      CatalogProductPrice,
      {
        $or: [
          { product: { $in: productIds } },
          { variant: { $in: [] } },
        ],
        organizationId,
        tenantId,
      },
      { populate: ['offer', 'variant', 'product', 'priceKind'] },
    ),
    storeCtx.channelBinding
      ? em.find(
          CatalogOffer,
          {
            product: { $in: productIds },
            channelId: storeCtx.channelBinding.salesChannelId,
            isActive: true,
            deletedAt: null,
          },
        )
      : Promise.resolve([] as CatalogOffer[]),
  ])

  const variantIds = variants.map((v) => v.id)
  let variantPrices: typeof allPrices = allPrices
  if (variantIds.length > 0) {
    variantPrices = await em.find(
      CatalogProductPrice,
      {
        $or: [
          { product: { $in: productIds } },
          { variant: { $in: variantIds } },
        ],
        organizationId,
        tenantId,
      },
      { populate: ['offer', 'variant', 'product', 'priceKind'] },
    )
  }

  const offerByProduct = new Map<string, CatalogOffer>()
  for (const offer of channelOffers) {
    const pid = typeof offer.product === 'string' ? offer.product : offer.product?.id
    if (pid) offerByProduct.set(pid, offer)
  }

  const categoriesByProduct = new Map<string, Array<{ id: string; name: string; slug: string | null }>>()
  for (const assignment of categoryAssignments) {
    const pid = typeof assignment.product === 'string' ? assignment.product : assignment.product?.id ?? null
    if (!pid) continue
    const cat = typeof assignment.category === 'string' ? null : assignment.category ?? null
    if (!cat) continue
    const bucket = categoriesByProduct.get(pid) ?? []
    bucket.push({ id: cat.id, name: cat.name, slug: cat.slug ?? null })
    categoriesByProduct.set(pid, bucket)
  }

  const tagsByProduct = new Map<string, string[]>()
  for (const assignment of tagAssignments) {
    const pid = typeof assignment.product === 'string' ? assignment.product : assignment.product?.id ?? null
    if (!pid) continue
    const tag = typeof assignment.tag === 'string' ? null : assignment.tag ?? null
    if (!tag) continue
    const bucket = tagsByProduct.get(pid) ?? []
    bucket.push(tag.label)
    tagsByProduct.set(pid, bucket)
  }

  const variantsByProduct = new Map<string, typeof variants>()
  const variantToProduct = new Map<string, string>()
  for (const variant of variants) {
    const pid = typeof variant.product === 'string' ? variant.product : variant.product?.id ?? null
    if (!pid) continue
    variantToProduct.set(variant.id, pid)
    const bucket = variantsByProduct.get(pid) ?? []
    bucket.push(variant)
    variantsByProduct.set(pid, bucket)
  }

  const pricesByProduct = new Map<string, PriceRow[]>()
  for (const price of variantPrices) {
    let pid: string | null = null
    if (price.product) {
      pid = typeof price.product === 'string' ? price.product : price.product?.id ?? null
    } else if (price.variant) {
      const vid = typeof price.variant === 'string' ? price.variant : price.variant.id
      pid = variantToProduct.get(vid) ?? null
    }
    if (!pid) continue
    const bucket = pricesByProduct.get(pid) ?? []
    bucket.push(price)
    pricesByProduct.set(pid, bucket)
  }

  const pricingCtx = buildPricingContext(storeCtx)

  const items: StorefrontProductItem[] = []
  const resolvedPricesForFacets: Array<{ unitPriceGross?: string | null; unitPriceNet?: string | null; currencyCode: string }> = []

  for (const product of allMatchingProducts) {
    const offer = offerByProduct.get(product.id) ?? null
    const title = resolveLocalizedTitle(product, offer, effectiveLocale)
    const subtitle = resolveLocalizedSubtitle(product, offer, effectiveLocale)

    const productVariants = variantsByProduct.get(product.id) ?? []
    const rawPriceCandidates = pricesByProduct.get(product.id) ?? []
    const priceCandidates = filterByPriceKind(rawPriceCandidates, storeCtx.channelBinding?.priceKindId)

    let priceRange: StorefrontProductItem['priceRange'] = null

    if (product.isConfigurable && productVariants.length > 1) {
      const variantPriceResults: Array<PriceRow> = []
      for (const variant of productVariants) {
        const variantCandidates = priceCandidates.filter(
          (p) => (typeof p.variant === 'string' ? p.variant : p.variant?.id) === variant.id
            || (!p.variant && !!p.product),
        )
        const best = await pricingService.resolvePrice(variantCandidates, pricingCtx)
        if (best) variantPriceResults.push(best)
      }
      const ranges = variantPriceResults
        .filter((p) => p.unitPriceGross ?? p.unitPriceNet)
        .map((p) => ({ unitPriceGross: p.unitPriceGross, unitPriceNet: p.unitPriceNet, currencyCode: p.currencyCode }))
      priceRange = computePriceRange(ranges)
    } else {
      const best = await pricingService.resolvePrice(priceCandidates, pricingCtx)
      if (best) {
        const val = best.unitPriceGross ?? best.unitPriceNet
        if (val) {
          priceRange = { min: val, max: val, currencyCode: best.currencyCode }
          resolvedPricesForFacets.push({ unitPriceGross: best.unitPriceGross, unitPriceNet: best.unitPriceNet, currencyCode: best.currencyCode })
        }
      }
    }

    // Apply price range filter
    if (query.priceMin != null || query.priceMax != null) {
      if (!priceRange) continue
      const minVal = parseFloat(priceRange.min)
      if (query.priceMin != null && minVal < query.priceMin) continue
      if (query.priceMax != null && minVal > query.priceMax) continue
    }

    items.push({
      id: product.id,
      handle: product.handle ?? null,
      title,
      subtitle,
      defaultMediaUrl: product.defaultMediaUrl ?? null,
      productType: product.productType,
      isConfigurable: product.isConfigurable,
      categories: categoriesByProduct.get(product.id) ?? [],
      tags: tagsByProduct.get(product.id) ?? [],
      priceRange,
      hasVariants: productVariants.length > 0,
      variantCount: productVariants.length,
    })
  }

  // Compute facets across all matching products (use a broader query for better accuracy)
  const allMatchingIds = restrictedIds ?? (await em.find(
    CatalogProduct,
    baseWhere as object,
    { fields: ['id'], limit: 5000 },
  )).map((p) => p.id)

  const [catFacets, tagFacets] = await Promise.all([
    computeCategoryFacets(em, organizationId, tenantId, allMatchingIds),
    computeTagFacets(em, organizationId, tenantId, allMatchingIds),
  ])

  const facetPriceRange = resolvedPricesForFacets.length
    ? computePriceRange(resolvedPricesForFacets)
    : null

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
    effectiveLocale,
    filters: {
      categories: catFacets,
      tags: tagFacets,
      priceRange: facetPriceRange
        ? { min: parseFloat(facetPriceRange.min), max: parseFloat(facetPriceRange.max), currencyCode: facetPriceRange.currencyCode }
        : null,
      options: [],
    },
  }
}

async function computeCategoryFacets(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
  productIds: string[],
): Promise<StorefrontFacets['categories']> {
  if (productIds.length === 0) return []

  const assignments = await em.find(
    CatalogProductCategoryAssignment,
    { product: { $in: productIds }, organizationId, tenantId },
    { populate: ['category'], fields: ['product', 'category'] },
  )

  const countByCategory = new Map<string, { name: string; slug: string | null; count: number }>()
  for (const assignment of assignments) {
    const cat = typeof assignment.category === 'string' ? null : assignment.category ?? null
    if (!cat) continue
    const existing = countByCategory.get(cat.id)
    if (existing) {
      existing.count++
    } else {
      countByCategory.set(cat.id, { name: cat.name, slug: cat.slug ?? null, count: 1 })
    }
  }

  return Array.from(countByCategory.entries())
    .map(([id, { name, slug, count }]) => ({ id, name, slug, count }))
    .sort((a, b) => b.count - a.count)
}

async function computeTagFacets(
  em: EntityManager,
  organizationId: string,
  tenantId: string,
  productIds: string[],
): Promise<StorefrontFacets['tags']> {
  if (productIds.length === 0) return []

  const assignments = await em.find(
    CatalogProductTagAssignment,
    { product: { $in: productIds }, organizationId, tenantId },
    { populate: ['tag'], fields: ['product', 'tag'] },
  )

  const countByTag = new Map<string, { label: string; count: number }>()
  for (const assignment of assignments) {
    const tag = typeof assignment.tag === 'string' ? null : assignment.tag ?? null
    if (!tag) continue
    const existing = countByTag.get(tag.slug)
    if (existing) {
      existing.count++
    } else {
      countByTag.set(tag.slug, { label: tag.label, count: 1 })
    }
  }

  return Array.from(countByTag.entries())
    .map(([slug, { label, count }]) => ({ slug, label, count }))
    .sort((a, b) => b.count - a.count)
}
