import type { AwilixContainer } from 'awilix'
import { LoadStrategy, type EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { sanitizeRichTextHtml } from '@open-mercato/shared/lib/html/sanitizeRichText'
import { SortDir, type QueryEngine, type Where } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'
import type { CatalogProductOptionSchema } from '@open-mercato/core/modules/catalog/data/types'
import { PRODUCT_SCOPE_KEYS_DOC_KEY, categoryScopeKey } from '@open-mercato/core/modules/catalog/lib/productScopeKeys'
import { buildStorefrontProductScope, composeStorefrontProductFilters } from './storefrontProductScope'
import {
  resolveStorefrontPrices,
  type StorefrontPrice,
  type StorefrontPriceTier,
} from './storefrontPricing'
import {
  STOREFRONT_CATEGORY_ENTITY_TYPE,
  STOREFRONT_OPTION_SCHEMA_ENTITY_TYPE,
  STOREFRONT_PRODUCT_ENTITY_TYPE,
  STOREFRONT_TAG_ENTITY_TYPE,
  STOREFRONT_VARIANT_ENTITY_TYPE,
  buildStorefrontListItem,
  isCategoryInAssortment,
  loadStorefrontTranslations,
  localeChain,
  localize,
  nonEmptyString,
  referenceId,
  resolveStorefrontAvailability,
  storefrontAvailabilityKey,
  stringList,
  toStorefrontAvailability,
  tryResolve,
  type StorefrontAvailability,
  type StorefrontAvailabilityTarget,
  type StorefrontProductListItem,
  type TagRef,
  type TranslationMap,
  type TranslationOverlay,
} from './storefrontCatalogSupport'
import type { StoreContext } from './types'

/** Storefront Public API §5.2: `relatedProducts` is capped at 8. */
export const STOREFRONT_RELATED_PRODUCTS_LIMIT = 8

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type StorefrontDimensions = {
  length: number | null
  width: number | null
  height: number | null
  unit: string | null
}

export type StorefrontProductMedia = { id: string; url: string; alt: string | null; sortOrder: number }

export type StorefrontDetailCategory = { id: string; name: string; slug: string | null; ancestorIds: string[] }

export type StorefrontBreadcrumbEntry = { id: string; name: string; slug: string | null }

export type StorefrontProductVariant = {
  id: string
  name: string
  sku: string | null
  optionValues: Record<string, string>
  isDefault: boolean
  price: StorefrontPrice | null
  availability: StorefrontAvailability
  dimensions: StorefrontDimensions | null
  weightValue: number | null
  weightUnit: string | null
}

export type StorefrontQuantityRules = {
  minOrderQuantity: number | null
  maxOrderQuantity: number | null
  quantityIncrement: number | null
}

export type StorefrontProductSeo = { title: string | null; description: string | null; canonicalUrl: string | null }

export type StorefrontProductDetail = Omit<StorefrontProductListItem, 'categories'> & {
  description: string | null
  sku: string | null
  media: StorefrontProductMedia[]
  dimensions: StorefrontDimensions | null
  weightValue: number | null
  weightUnit: string | null
  categories: StorefrontDetailCategory[]
  breadcrumb: StorefrontBreadcrumbEntry[]
  optionSchema: CatalogProductOptionSchema | null
  variants: StorefrontProductVariant[]
  /** The requested `variantId` when it is one of `variants`, else the default variant, else null. */
  selectedVariantId: string | null
  quantityRules: StorefrontQuantityRules
  priceTiers: StorefrontPriceTier[]
  relatedProducts: StorefrontProductListItem[]
  seo: StorefrontProductSeo
}

export type GetStorefrontProductDetailOptions = {
  variantId?: string | null
  /** Overrides `ctx.effectiveLocale` for the overlay chain when it is one of the store's supported locales. */
  locale?: string | null
  date?: Date
}

/** Translation field carrying an option label of an option schema template (D20). */
export function optionLabelTranslationField(optionCode: string): string {
  return `options.${optionCode}.label`
}

/** Translation field carrying a choice label of an option schema template (D20). */
export function optionChoiceLabelTranslationField(optionCode: string, choiceCode: string): string {
  return `options.${optionCode}.choices.${choiceCode}.label`
}

type DetailRuntime = {
  container: AwilixContainer
  ctx: StoreContext
  em: EntityManager
  queryEngine: QueryEngine
  decryptionScope: { tenantId: string; organizationId: string }
}

type VisibleCategory = {
  id: string
  name: string
  slug: string | null
  ancestorIds: string[]
}

type LoadedProduct = {
  product: CatalogProduct
  variants: CatalogProductVariant[]
  categories: VisibleCategory[]
  tags: TagRef[]
}

function collectionItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[]
  if (value && typeof value === 'object' && 'getItems' in value) {
    const getItems = (value as { getItems: unknown }).getItems
    if (typeof getItems === 'function') {
      try {
        return getItems.call(value) as T[]
      } catch {
        return []
      }
    }
  }
  return []
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function toDimensions(value: unknown): StorefrontDimensions | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const dimensions: StorefrontDimensions = {
    length: toNumber(source.length ?? source.depth),
    width: toNumber(source.width),
    height: toNumber(source.height),
    unit: nonEmptyString(source.unit),
  }
  const empty = dimensions.length === null && dimensions.width === null && dimensions.height === null
  return empty && dimensions.unit === null ? null : dimensions
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  return Object.fromEntries(entries)
}

function lookupClause(idOrHandle: string): Where {
  const value = idOrHandle.trim()
  return UUID_PATTERN.test(value) ? { id: { $eq: value } } : { handle: { $eq: value } }
}

/**
 * The detail lookup: the id/handle match AND the full storefront scope in one query (§3.3, R4), so
 * a restricted, inactive, deleted, other-tenant or nonexistent product all end here with the same
 * single empty query and nothing else runs.
 */
async function findScopedProductId(runtime: DetailRuntime, idOrHandle: string): Promise<string | null> {
  const scope = buildStorefrontProductScope(runtime.ctx)
  const result = await runtime.queryEngine.query<{ id: string }>(E.catalog.catalog_product, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    withDeleted: scope.withDeleted,
    filters: composeStorefrontProductFilters(scope, lookupClause(idOrHandle)),
    fields: ['id'],
    page: { page: 1, pageSize: 1 },
  })
  const [first] = result.items
  return first && typeof first.id === 'string' ? first.id : null
}

/**
 * Products with their variants, category and tag assignments (and, for the detail product, the
 * option schema template) in one joined query — the row count grows with variants × assignments of
 * the loaded products, the query count does not.
 */
async function loadProducts(runtime: DetailRuntime, ids: string[], withOptionSchema: boolean): Promise<LoadedProduct[]> {
  if (!ids.length) return []
  const { ctx } = runtime
  const populate: Array<'variants' | 'categoryAssignments.category' | 'tagAssignments.tag' | 'optionSchemaTemplate'> = [
    'variants',
    'categoryAssignments.category',
    'tagAssignments.tag',
  ]
  if (withOptionSchema) populate.push('optionSchemaTemplate')
  const products = await findWithDecryption(
    runtime.em,
    CatalogProduct,
    { id: { $in: ids }, tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null, isActive: true },
    { populate, strategy: LoadStrategy.JOINED },
    runtime.decryptionScope,
  )
  const byId = new Map(products.map((product) => [product.id, product]))
  return ids.flatMap((id) => {
    const product = byId.get(id)
    return product ? [toLoadedProduct(runtime, product)] : []
  })
}

function toLoadedProduct(runtime: DetailRuntime, product: CatalogProduct): LoadedProduct {
  const { ctx } = runtime
  const variants = collectionItems<CatalogProductVariant>(product.variants)
    .filter((variant) => !variant.deletedAt && variant.isActive !== false)
    .map((variant, index) => ({ variant, index }))
    .sort(
      (left, right) =>
        Number(right.variant.isDefault === true) - Number(left.variant.isDefault === true) || left.index - right.index,
    )
    .map((entry) => entry.variant)
  const categories: VisibleCategory[] = []
  const assignments = collectionItems<{ position?: number | null; category?: unknown }>(product.categoryAssignments)
    .map((assignment, index) => ({ assignment, index }))
    .sort((left, right) => (left.assignment.position ?? 0) - (right.assignment.position ?? 0) || left.index - right.index)
  for (const { assignment } of assignments) {
    const category = assignment.category as CatalogProductCategory | null | undefined
    if (!category || typeof category !== 'object' || category.deletedAt || category.isActive === false) continue
    if (category.tenantId !== ctx.tenantId || category.organizationId !== ctx.organizationId) continue
    const ancestorIds = stringList(category.ancestorIds)
    const lineage = { id: category.id, ancestorIds, descendantIds: stringList(category.descendantIds) }
    if (!isCategoryInAssortment(lineage, ctx.buyer.assortmentScope)) continue
    if (categories.some((entry) => entry.id === category.id)) continue
    categories.push({ id: category.id, name: category.name, slug: category.slug ?? null, ancestorIds })
  }
  const tags: TagRef[] = []
  for (const assignment of collectionItems<{ tag?: unknown }>(product.tagAssignments)) {
    const tag = assignment.tag as { id?: string; label?: string; tenantId?: string; organizationId?: string } | null
    if (!tag || typeof tag !== 'object' || typeof tag.id !== 'string') continue
    if (tag.tenantId !== ctx.tenantId || tag.organizationId !== ctx.organizationId) continue
    if (tags.some((entry) => entry.id === tag.id)) continue
    tags.push({ id: tag.id, label: tag.label ?? '' })
  }
  return { product, variants, categories, tags }
}

async function findRelatedProductIds(runtime: DetailRuntime, product: LoadedProduct): Promise<string[]> {
  if (!product.categories.length) return []
  const scope = buildStorefrontProductScope(runtime.ctx)
  const result = await runtime.queryEngine.query<{ id: string }>(E.catalog.catalog_product, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    withDeleted: scope.withDeleted,
    filters: composeStorefrontProductFilters(scope, {
      [PRODUCT_SCOPE_KEYS_DOC_KEY]: { $overlap: product.categories.map((category) => categoryScopeKey(category.id)) },
      id: { $nin: [product.product.id] },
    }),
    fields: ['id'],
    sort: [{ field: 'created_at', dir: SortDir.Desc }],
    page: { page: 1, pageSize: STOREFRONT_RELATED_PRODUCTS_LIMIT },
  })
  return result.items
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string' && id !== product.product.id)
}

async function loadBreadcrumbAncestors(runtime: DetailRuntime, primary: VisibleCategory | undefined): Promise<VisibleCategory[]> {
  if (!primary?.ancestorIds.length) return []
  const { ctx } = runtime
  const rows = await findWithDecryption(
    runtime.em,
    CatalogProductCategory,
    {
      id: { $in: primary.ancestorIds },
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
      isActive: true,
    },
    { fields: ['id', 'name', 'slug', 'ancestorIds'] },
    runtime.decryptionScope,
  )
  const byId = new Map(rows.map((row) => [row.id, row]))
  return primary.ancestorIds.flatMap((id) => {
    const row = byId.get(id)
    return row ? [{ id: row.id, name: row.name, slug: row.slug ?? null, ancestorIds: stringList(row.ancestorIds) }] : []
  })
}

async function loadMedia(runtime: DetailRuntime, product: CatalogProduct): Promise<StorefrontProductMedia[]> {
  const { ctx } = runtime
  const attachments = await findWithDecryption(
    runtime.em,
    Attachment,
    {
      entityId: E.catalog.catalog_product,
      recordId: product.id,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
    },
    { fields: ['id', 'url', 'createdAt'], orderBy: { createdAt: 'asc' } },
    runtime.decryptionScope,
  )
  const defaultMediaId = product.defaultMediaId ?? null
  return attachments
    .filter((attachment) => nonEmptyString(attachment.url) !== null)
    .map((attachment, index) => ({ attachment, index }))
    .sort(
      (left, right) =>
        Number(right.attachment.id === defaultMediaId) - Number(left.attachment.id === defaultMediaId) ||
        left.index - right.index,
    )
    .map(({ attachment }, sortOrder) => ({ id: attachment.id, url: attachment.url, alt: null, sortOrder }))
}

function localizeOptionSchema(
  product: CatalogProduct,
  ctx: StoreContext,
  overlay: TranslationOverlay | undefined,
  locales: string[],
): CatalogProductOptionSchema | null {
  const template = product.optionSchemaTemplate
  if (!template || typeof template !== 'object' || template.deletedAt || template.isActive === false) return null
  if (template.tenantId !== ctx.tenantId || template.organizationId !== ctx.organizationId) return null
  const schema = template.schema
  if (!schema || typeof schema !== 'object' || !Array.isArray(schema.options)) return null
  return {
    ...schema,
    name: localize(schema.name ?? template.name, overlay, 'name', locales),
    description: localize(schema.description ?? template.description, overlay, 'description', locales),
    options: schema.options.map((option) => ({
      ...option,
      label: localize(option.label, overlay, optionLabelTranslationField(option.code), locales) ?? option.label,
      ...(Array.isArray(option.choices)
        ? {
            choices: option.choices.map((choice) => ({
              ...choice,
              label:
                localize(choice.label, overlay, optionChoiceLabelTranslationField(option.code, choice.code), locales) ??
                choice.label ??
                null,
            })),
          }
        : {}),
    })),
  }
}

function sanitizeDescription(value: string | null): string | null {
  if (value === null) return null
  const sanitized = sanitizeRichTextHtml(value)
  return sanitized.trim().length ? sanitized : null
}

function relatedListItems(
  related: LoadedProduct[],
  context: {
    locales: string[]
    productTranslations?: TranslationMap
    categoryTranslations?: TranslationMap
    tagTranslations?: TranslationMap
    pricing: Awaited<ReturnType<typeof resolveStorefrontPrices>>
    availability: Awaited<ReturnType<typeof resolveStorefrontAvailability>>
  },
): StorefrontProductListItem[] {
  const items: StorefrontProductListItem[] = []
  for (const entry of related) {
    const { product } = entry
    const resolved = context.availability.get(storefrontAvailabilityKey({ productId: product.id, variantId: null }))
    const availability = toStorefrontAvailability(resolved?.result ?? null)
    if (resolved?.policy?.hideWhenOutOfStock?.value === true && availability.state === 'out_of_stock') continue
    items.push(
      buildStorefrontListItem(
        {
          id: product.id,
          handle: product.handle,
          title: product.title,
          subtitle: product.subtitle,
          defaultMediaUrl: product.defaultMediaUrl,
          productType: product.productType,
          isConfigurable: product.isConfigurable,
        },
        {
          locales: context.locales,
          overlay: context.productTranslations?.get(product.id),
          variantCount: entry.variants.length,
          categories: entry.categories,
          categoryTranslations: context.categoryTranslations,
          tags: entry.tags,
          tagTranslations: context.tagTranslations,
          pricing: context.pricing.get(product.id),
          availability,
        },
      ),
    )
  }
  return items
}

/**
 * `GET /products/:idOrHandle` (Storefront Public API rev 4 §4.2, §5.2, §7, §10).
 *
 * Returns `null` — mapped by the route to one 404 body — for a product that is nonexistent,
 * inactive, deleted, of another tenant or outside the buyer's effective assortment: the id/handle
 * match and the assortment invariant are one query, and nothing else runs when it is empty (R4).
 * A found product is hydrated with a constant number of batched queries regardless of its variant
 * count: one joined product load, related-product lookup and load, breadcrumb ancestors, media,
 * one price query (§6.1, per variant and with tiers), one translation query for every overlaid
 * entity type, one availability state and one policy resolution. `relatedProducts` are up to 8
 * products sharing a category (or a category's subtree) within the same scope.
 */
export async function getStorefrontProductDetail(
  container: AwilixContainer,
  ctx: StoreContext,
  idOrHandle: string,
  options: GetStorefrontProductDetailOptions = {},
): Promise<StorefrontProductDetail | null> {
  const em = tryResolve<EntityManager>(container, 'em')
  const queryEngine = tryResolve<QueryEngine>(container, 'queryEngine')
  if (!em || !queryEngine) throw new Error('[internal] ecommerce storefront detail requires em and queryEngine')
  const runtime: DetailRuntime = {
    container,
    ctx,
    em,
    queryEngine,
    decryptionScope: { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  }

  const productId = await findScopedProductId(runtime, idOrHandle)
  if (!productId) return null
  const [main] = await loadProducts(runtime, [productId], true)
  if (!main) return null
  const { product } = main
  const primaryCategory = main.categories[0]

  const [relatedIds, ancestors, media] = await Promise.all([
    findRelatedProductIds(runtime, main),
    loadBreadcrumbAncestors(runtime, primaryCategory),
    loadMedia(runtime, product),
  ])
  const related = await loadProducts(runtime, relatedIds, false)
  const variantIds = main.variants.map((variant) => variant.id)
  const templateId = referenceId(product.optionSchemaTemplate)

  const categoryIds = new Set<string>([...ancestors.map((category) => category.id)])
  const tagIds = new Set<string>()
  for (const entry of [main, ...related]) {
    for (const category of entry.categories) categoryIds.add(category.id)
    for (const tag of entry.tags) tagIds.add(tag.id)
  }
  const availabilityTargets: StorefrontAvailabilityTarget[] = [
    { productId: product.id, variantId: null },
    ...variantIds.map((variantId) => ({ productId: product.id, variantId })),
    ...related.map((entry) => ({ productId: entry.product.id, variantId: null })),
  ]

  const [pricing, translations, availability] = await Promise.all([
    resolveStorefrontPrices(
      container,
      ctx,
      [
        { productId: product.id, variantIds },
        ...related.map((entry) => ({ productId: entry.product.id, variantIds: entry.variants.map((variant) => variant.id) })),
      ],
      { detail: true, date: options.date },
    ),
    loadStorefrontTranslations(em, ctx, [
      { entityType: STOREFRONT_PRODUCT_ENTITY_TYPE, ids: [product.id, ...related.map((entry) => entry.product.id)] },
      { entityType: STOREFRONT_VARIANT_ENTITY_TYPE, ids: variantIds },
      { entityType: STOREFRONT_CATEGORY_ENTITY_TYPE, ids: Array.from(categoryIds) },
      { entityType: STOREFRONT_TAG_ENTITY_TYPE, ids: Array.from(tagIds) },
      { entityType: STOREFRONT_OPTION_SCHEMA_ENTITY_TYPE, ids: templateId ? [templateId] : [] },
    ]),
    resolveStorefrontAvailability(container, ctx, em, availabilityTargets),
  ])

  const locales = localeChain(ctx, options.locale)
  const productTranslations = translations.get(STOREFRONT_PRODUCT_ENTITY_TYPE)
  const variantTranslations = translations.get(STOREFRONT_VARIANT_ENTITY_TYPE)
  const categoryTranslations = translations.get(STOREFRONT_CATEGORY_ENTITY_TYPE)
  const tagTranslations = translations.get(STOREFRONT_TAG_ENTITY_TYPE)
  const overlay = productTranslations?.get(product.id)
  const productPricing = pricing.get(product.id)
  const productAvailability = availability.get(storefrontAvailabilityKey({ productId: product.id, variantId: null }))
  const policy = productAvailability?.policy ?? null

  const listItem = buildStorefrontListItem(
    {
      id: product.id,
      handle: product.handle,
      title: product.title,
      subtitle: product.subtitle,
      defaultMediaUrl: product.defaultMediaUrl,
      productType: product.productType,
      isConfigurable: product.isConfigurable,
    },
    {
      locales,
      overlay,
      variantCount: main.variants.length,
      categories: [],
      tags: main.tags,
      tagTranslations,
      pricing: productPricing,
      availability: toStorefrontAvailability(productAvailability?.result ?? null),
    },
  )
  const categoryName = (category: VisibleCategory) =>
    localize(category.name, categoryTranslations?.get(category.id), 'name', locales) ?? category.name

  const variants: StorefrontProductVariant[] = main.variants.map((variant) => {
    const variantAvailability = availability.get(storefrontAvailabilityKey({ productId: product.id, variantId: variant.id }))
    return {
      id: variant.id,
      name:
        localize(variant.name, variantTranslations?.get(variant.id), 'name', locales) ??
        nonEmptyString(variant.sku) ??
        '',
      sku: nonEmptyString(variant.sku),
      optionValues: stringRecord(variant.optionValues),
      isDefault: variant.isDefault === true,
      price: productPricing?.variantPrices.get(variant.id) ?? null,
      availability: toStorefrontAvailability(variantAvailability?.result ?? null),
      dimensions: toDimensions(variant.dimensions),
      weightValue: toNumber(variant.weightValue),
      weightUnit: nonEmptyString(variant.weightUnit),
    }
  })
  const requestedVariant = options.variantId ? variants.find((variant) => variant.id === options.variantId) : undefined
  const defaultVariant = variants.find((variant) => variant.isDefault)

  return {
    ...listItem,
    description: sanitizeDescription(localize(product.description, overlay, 'description', locales)),
    sku: nonEmptyString(product.sku),
    media,
    dimensions: toDimensions(product.dimensions),
    weightValue: toNumber(product.weightValue),
    weightUnit: nonEmptyString(product.weightUnit),
    categories: main.categories.map((category) => ({
      id: category.id,
      name: categoryName(category),
      slug: category.slug,
      ancestorIds: category.ancestorIds,
    })),
    breadcrumb: primaryCategory
      ? [...ancestors, primaryCategory].map((category) => ({
          id: category.id,
          name: categoryName(category),
          slug: category.slug,
        }))
      : [],
    optionSchema: localizeOptionSchema(
      product,
      ctx,
      templateId ? translations.get(STOREFRONT_OPTION_SCHEMA_ENTITY_TYPE)?.get(templateId) : undefined,
      locales,
    ),
    variants,
    selectedVariantId: requestedVariant?.id ?? defaultVariant?.id ?? null,
    quantityRules: {
      minOrderQuantity: policy?.minOrderQuantity?.value ?? toNumber(product.minOrderQty),
      maxOrderQuantity: policy?.maxOrderQuantity?.value ?? toNumber(product.maxOrderQty),
      quantityIncrement: policy?.quantityIncrement?.value ?? toNumber(product.orderQtyIncrement),
    },
    priceTiers: productPricing?.priceTiers ?? [],
    relatedProducts: relatedListItems(related, {
      locales,
      productTranslations,
      categoryTranslations,
      tagTranslations,
      pricing,
      availability,
    }),
    seo: {
      title: localize(product.seoTitle, overlay, 'seoTitle', locales),
      description: localize(product.seoDescription, overlay, 'seoDescription', locales),
      canonicalUrl: nonEmptyString(product.canonicalUrl),
    },
  }
}
