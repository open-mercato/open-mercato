import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import type { AvailabilityState } from '@open-mercato/shared/lib/availability'
import type { EffectiveAssortmentScope } from '@open-mercato/shared/lib/catalog-visibility'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { defaultLocale } from '@open-mercato/shared/lib/i18n/config'
import { resolveSupportedLocale } from '@open-mercato/shared/lib/i18n/locale'
import { loadDictionary } from '@open-mercato/shared/lib/i18n/server'
import { createFallbackTranslator } from '@open-mercato/shared/lib/i18n/translate'
import type { QueryEngine, Where } from '@open-mercato/shared/lib/query/types'
import { E } from '#generated/entities.ids.generated'
import {
  CatalogOptionSchemaTemplate,
  CatalogProductCategory,
  CatalogProductVariant,
} from '@open-mercato/core/modules/catalog/data/entities'
import {
  CATALOG_PRODUCT_TYPES,
  type CatalogProductOptionDefinition,
} from '@open-mercato/core/modules/catalog/data/types'
import {
  optionChoiceLabelTranslationField,
  optionLabelTranslationField,
} from '@open-mercato/core/modules/catalog/lib/optionSchemaTranslations'
import { compareCodeUnits } from '@open-mercato/core/modules/catalog/lib/productScopeKeys'
import type { EcommerceStorefrontProductListQuery } from '../data/validators'
import { catalogCategoryTag, catalogProductsTag, storefrontCache, storefrontCacheValueHash } from './cacheKeys'
import {
  STOREFRONT_CATEGORY_ENTITY_TYPE,
  STOREFRONT_OPTION_SCHEMA_ENTITY_TYPE,
  STOREFRONT_TAG_ENTITY_TYPE,
  isCategoryInAssortment,
  localize,
  nonEmptyString,
  referenceId,
  stringList,
  type TranslationMap,
} from './storefrontCatalogSupport'
import type { StorefrontProductScope } from './storefrontProductScope'
import type { StoreContext } from './types'

/**
 * Listing facets (Storefront Public API rev 4 §5.3, §5.4, §9.1).
 *
 * The four count facets (`categories`, `tags`, `options`, `productTypes`) are buyer-independent
 * beyond the assortment, so they are computed once per assortment scope and cached under
 * `assortmentScopeHash` (`scope: 'assortment'`). `priceRange` is buyer-priced and is computed and
 * cached with the items on the full digest — never here. `availability` counts the returned page
 * only (D21) and is computed by the listing.
 *
 * Cross-exclusion: the facet universe is the assortment scope plus the search term (the only
 * non-facet product filter). Each dimension then applies every active filter except its own, in
 * memory, over that universe — so with no filters every dimension shares one universe load, and
 * with filters no dimension costs an extra query. Option codes are separate dimensions: the
 * counts for `options[color]` keep `options[size]` applied (on the same variant) but not
 * `options[color]`. The price filter is not applied to count facets — it depends on the buyer's
 * prices, which the assortment-keyed entry must not.
 */

export const STOREFRONT_COUNT_FACETS_TTL_MS = 30_000

const COUNT_FACETS_CACHE_SEGMENT = 'products-count-facets'
const UNIVERSE_PAGE_SIZE = 10_000
const VARIANT_ID_CHUNK = 10_000
const CATALOG_PRODUCT_TYPE_LABEL_PREFIX = 'catalog.products.types.'

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

export type StorefrontCountFacets = Pick<StorefrontFacets, 'categories' | 'tags' | 'options' | 'productTypes'>

/** The facet filters the listing actually applied (unknown or out-of-assortment selections already dropped). */
export type StorefrontFacetSelection = {
  categoryId: string | null
  tagIds: string[]
  productType: string | null
  options: Record<string, string[]>
}

export type StorefrontFacetRuntime = {
  ctx: StoreContext
  em: EntityManager
  queryEngine: QueryEngine
  scope: StorefrontProductScope
  decryptionScope: { tenantId: string; organizationId: string }
}

export type StorefrontFacetProduct = {
  id: string
  productType: string
  templateId: string | null
  categoryIds: string[]
  tagIds: string[]
}

export type StorefrontFacetVariant = { id: string; optionValues: Record<string, string> }

export type StorefrontFacetCategory = {
  id: string
  name: string
  slug: string | null
  depth: number
  parentId: string | null
  isActive: boolean
  ancestorIds: string[]
  descendantIds: string[]
}

export type StorefrontFacetTag = { id: string; slug: string; label: string }

export type StorefrontFacetSource = {
  products: StorefrontFacetProduct[]
  variants: Map<string, StorefrontFacetVariant[]>
  categories: Map<string, StorefrontFacetCategory>
  tags: Map<string, StorefrontFacetTag>
  templates: Map<string, CatalogProductOptionDefinition[]>
}

export type StorefrontRawCountFacets = {
  categories: Map<string, number>
  tags: Map<string, number>
  productTypes: Map<string, number>
  options: Map<string, Map<string, number>>
}

type UniverseRecord = { id?: unknown; product_type?: unknown; option_schema_id?: unknown }

type FacetAssignmentDatabase = {
  catalog_product_category_assignments: {
    product_id: string
    category_id: string
    tenant_id: string
    organization_id: string
  }
  catalog_product_tag_assignments: {
    product_id: string
    tag_id: string
    tenant_id: string
    organization_id: string
  }
  catalog_product_tags: {
    id: string
    slug: string
    label: string
    tenant_id: string
    organization_id: string
  }
}

type AssignmentRow = { product_id: string; kind: string; ref_id: string; slug: string | null; label: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

function increment<K>(counts: Map<K, number>, key: K): void {
  counts.set(key, (counts.get(key) ?? 0) + 1)
}

/**
 * The count-facet key part: the facet-relevant query parameters only. Price, sort, paging,
 * availability and locale are excluded (locale is already part of the assortment scope segment).
 */
export function storefrontCountFacetCacheParts(query: EcommerceStorefrontProductListQuery): string[] {
  return [
    COUNT_FACETS_CACHE_SEGMENT,
    storefrontCacheValueHash({
      search: query.search,
      categoryId: query.categoryId,
      categorySlug: query.categorySlug,
      tagSlugs: query.tagSlugs,
      options: query.options,
      productType: query.productType,
    }),
  ]
}

export function storefrontCountFacetCacheTags(ctx: StoreContext, selection: Pick<StorefrontFacetSelection, 'categoryId'>): string[] {
  return [catalogProductsTag(ctx.tenantId), ...(selection.categoryId ? [catalogCategoryTag(selection.categoryId)] : [])]
}

export async function readCachedStorefrontCountFacets(
  container: AwilixContainer,
  ctx: StoreContext,
  query: EcommerceStorefrontProductListQuery,
): Promise<StorefrontCountFacets | null> {
  return storefrontCache(container, ctx).get<StorefrontCountFacets>(storefrontCountFacetCacheParts(query), {
    scope: 'assortment',
  })
}

export async function writeCachedStorefrontCountFacets(
  container: AwilixContainer,
  ctx: StoreContext,
  query: EcommerceStorefrontProductListQuery,
  facets: StorefrontCountFacets,
  selection: Pick<StorefrontFacetSelection, 'categoryId'>,
): Promise<void> {
  await storefrontCache(container, ctx).set(storefrontCountFacetCacheParts(query), facets, {
    scope: 'assortment',
    ttlMs: STOREFRONT_COUNT_FACETS_TTL_MS,
    tags: storefrontCountFacetCacheTags(ctx, selection),
  })
}

async function queryUniverse(runtime: StorefrontFacetRuntime, filters: Where): Promise<UniverseRecord[]> {
  const run = (pageSize: number) =>
    runtime.queryEngine.query<UniverseRecord>(E.catalog.catalog_product, {
      tenantId: runtime.scope.tenantId,
      organizationId: runtime.scope.organizationId,
      withDeleted: runtime.scope.withDeleted,
      filters,
      fields: ['id', 'product_type', 'option_schema_id'],
      page: { page: 1, pageSize },
    })
  const first = await run(UNIVERSE_PAGE_SIZE)
  if (first.total <= first.items.length) return first.items
  return (await run(first.total)).items
}

async function loadAssignments(runtime: StorefrontFacetRuntime, productIds: string[]): Promise<AssignmentRow[]> {
  const { tenantId, organizationId } = runtime.decryptionScope
  const db = runtime.em.getKysely<FacetAssignmentDatabase>()
  const categoryRows = db
    .selectFrom('catalog_product_category_assignments as ca')
    .select([
      'ca.product_id as product_id',
      sql<string>`'category'`.as('kind'),
      'ca.category_id as ref_id',
      sql<string | null>`null`.as('slug'),
      sql<string | null>`null`.as('label'),
    ])
    .where(sql<boolean>`${sql.ref('ca.product_id')} = any(${productIds}::uuid[])`)
    .where('ca.tenant_id', '=', tenantId)
    .where('ca.organization_id', '=', organizationId)
  const tagRows = db
    .selectFrom('catalog_product_tag_assignments as ta')
    .innerJoin('catalog_product_tags as tg', 'tg.id', 'ta.tag_id')
    .select([
      'ta.product_id as product_id',
      sql<string>`'tag'`.as('kind'),
      'ta.tag_id as ref_id',
      sql<string | null>`${sql.ref('tg.slug')}`.as('slug'),
      sql<string | null>`${sql.ref('tg.label')}`.as('label'),
    ])
    .where(sql<boolean>`${sql.ref('ta.product_id')} = any(${productIds}::uuid[])`)
    .where('ta.tenant_id', '=', tenantId)
    .where('ta.organization_id', '=', organizationId)
    .where('tg.tenant_id', '=', tenantId)
    .where('tg.organization_id', '=', organizationId)
  return categoryRows.unionAll(tagRows).execute()
}

async function loadCategories(runtime: StorefrontFacetRuntime): Promise<Map<string, StorefrontFacetCategory>> {
  const { ctx } = runtime
  const rows = await findWithDecryption(
    runtime.em,
    CatalogProductCategory,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null },
    { fields: ['id', 'name', 'slug', 'depth', 'parentId', 'isActive', 'ancestorIds', 'descendantIds'] },
    runtime.decryptionScope,
  )
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        slug: row.slug ?? null,
        depth: typeof row.depth === 'number' ? row.depth : 0,
        parentId: row.parentId ?? null,
        isActive: row.isActive !== false,
        ancestorIds: stringList(row.ancestorIds),
        descendantIds: stringList(row.descendantIds),
      },
    ]),
  )
}

async function loadVariants(
  runtime: StorefrontFacetRuntime,
  productIds: string[],
): Promise<Map<string, StorefrontFacetVariant[]>> {
  const { ctx } = runtime
  const batches = await Promise.all(
    chunk(productIds, VARIANT_ID_CHUNK).map((ids) =>
      findWithDecryption(
        runtime.em,
        CatalogProductVariant,
        { tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null, isActive: true, product: { $in: ids } },
        { fields: ['id', 'product', 'optionValues'] },
        runtime.decryptionScope,
      ),
    ),
  )
  const byProduct = new Map<string, StorefrontFacetVariant[]>()
  for (const variant of batches.flat()) {
    const productId = referenceId(variant.product)
    if (!productId) continue
    const optionValues: Record<string, string> = {}
    if (isRecord(variant.optionValues)) {
      for (const [code, value] of Object.entries(variant.optionValues)) {
        const text = nonEmptyString(value)
        if (text !== null) optionValues[code] = text
      }
    }
    const bucket = byProduct.get(productId) ?? []
    bucket.push({ id: variant.id, optionValues })
    byProduct.set(productId, bucket)
  }
  return byProduct
}

async function loadTemplates(
  runtime: StorefrontFacetRuntime,
  templateIds: string[],
): Promise<Map<string, CatalogProductOptionDefinition[]>> {
  const templates = new Map<string, CatalogProductOptionDefinition[]>()
  if (!templateIds.length) return templates
  const { ctx } = runtime
  const rows = await findWithDecryption(
    runtime.em,
    CatalogOptionSchemaTemplate,
    { id: { $in: templateIds }, tenantId: ctx.tenantId, organizationId: ctx.organizationId, deletedAt: null, isActive: true },
    { fields: ['id', 'schema'] },
    runtime.decryptionScope,
  )
  for (const row of rows) {
    const options = isRecord(row.schema) && Array.isArray(row.schema.options) ? row.schema.options : []
    templates.set(
      row.id,
      options.filter((option): option is CatalogProductOptionDefinition => isRecord(option) && nonEmptyString(option.code) !== null),
    )
  }
  return templates
}

/**
 * The facet universe and everything the count facets read: the scoped products (one query-engine
 * call composing `filters`, normally the assortment scope plus the search clause), their category
 * and tag assignments (one union query), the tenant's categories, the products' active variants
 * and the option schema templates they use. Five queries regardless of the universe size up to
 * 10 000 products; the variant list doubles as the listing's variant index.
 */
export async function loadStorefrontFacetSource(
  runtime: StorefrontFacetRuntime,
  filters: Where,
): Promise<StorefrontFacetSource> {
  const records = await queryUniverse(runtime, filters)
  const products = new Map<string, StorefrontFacetProduct>()
  for (const record of records) {
    if (typeof record.id !== 'string' || products.has(record.id)) continue
    products.set(record.id, {
      id: record.id,
      productType: nonEmptyString(record.product_type) ?? 'simple',
      templateId: nonEmptyString(record.option_schema_id),
      categoryIds: [],
      tagIds: [],
    })
  }
  const productIds = Array.from(products.keys())
  if (!productIds.length) {
    return { products: [], variants: new Map(), categories: new Map(), tags: new Map(), templates: new Map() }
  }
  const templateIds = Array.from(
    new Set(Array.from(products.values()).flatMap((product) => (product.templateId ? [product.templateId] : []))),
  )
  const [assignments, categories, variants, templates] = await Promise.all([
    loadAssignments(runtime, productIds),
    loadCategories(runtime),
    loadVariants(runtime, productIds),
    loadTemplates(runtime, templateIds),
  ])
  const tags = new Map<string, StorefrontFacetTag>()
  for (const row of assignments) {
    const product = products.get(String(row.product_id))
    const refId = String(row.ref_id)
    if (!product) continue
    if (row.kind === 'category') {
      if (!product.categoryIds.includes(refId)) product.categoryIds.push(refId)
      continue
    }
    if (!product.tagIds.includes(refId)) product.tagIds.push(refId)
    if (!tags.has(refId)) tags.set(refId, { id: refId, slug: row.slug ?? '', label: row.label ?? '' })
  }
  return { products: Array.from(products.values()), variants, categories, tags, templates }
}

export function storefrontFacetVariantIndex(source: StorefrontFacetSource): Map<string, string[]> {
  const index = new Map<string, string[]>()
  for (const product of source.products) {
    index.set(product.id, (source.variants.get(product.id) ?? []).map((variant) => variant.id))
  }
  return index
}

function variantMatches(
  variant: StorefrontFacetVariant,
  options: Record<string, string[]>,
  exceptCode: string | null,
): boolean {
  return Object.entries(options).every(([code, values]) => {
    if (code === exceptCode) return true
    const value = variant.optionValues[code]
    return value !== undefined && values.includes(value)
  })
}

/**
 * Cross-facet exclusion (§5.4) over the facet universe: each dimension counts the products that
 * match every active filter except its own. Category counts include descendants (a product counts
 * for a category when it is assigned to it or to one of its descendants, as the filter does); option
 * counts are per option code and count a product once per value carried by any of its variants that
 * also matches the other option filters.
 */
export function countStorefrontFacets(
  source: StorefrontFacetSource,
  selection: StorefrontFacetSelection,
): StorefrontRawCountFacets {
  const selectedCategory = selection.categoryId ? source.categories.get(selection.categoryId) : undefined
  const categoryReach = selection.categoryId
    ? new Set([selection.categoryId, ...(selectedCategory?.descendantIds ?? [])])
    : null
  const tagSet = selection.tagIds.length ? new Set(selection.tagIds) : null
  const optionCodes = Object.keys(selection.options)
  const variantsOf = (product: StorefrontFacetProduct) => source.variants.get(product.id) ?? []

  const inCategory = (product: StorefrontFacetProduct) =>
    !categoryReach || product.categoryIds.some((id) => categoryReach.has(id))
  const inTags = (product: StorefrontFacetProduct) => !tagSet || product.tagIds.some((id) => tagSet.has(id))
  const inType = (product: StorefrontFacetProduct) =>
    !selection.productType || product.productType === selection.productType
  const inOptions = (product: StorefrontFacetProduct) =>
    optionCodes.length === 0 || variantsOf(product).some((variant) => variantMatches(variant, selection.options, null))

  const contributors = new Map<string, string[]>()
  for (const category of source.categories.values()) {
    for (const id of [category.id, ...category.descendantIds]) {
      const bucket = contributors.get(id) ?? []
      bucket.push(category.id)
      contributors.set(id, bucket)
    }
  }

  const raw: StorefrontRawCountFacets = {
    categories: new Map(),
    tags: new Map(),
    productTypes: new Map(),
    options: new Map(),
  }
  const codes = new Set<string>(optionCodes)
  for (const product of source.products) {
    for (const variant of variantsOf(product)) for (const code of Object.keys(variant.optionValues)) codes.add(code)
  }

  for (const product of source.products) {
    const category = inCategory(product)
    const tags = inTags(product)
    const type = inType(product)
    const options = inOptions(product)
    if (tags && type && options) {
      const reached = new Set<string>()
      for (const assignedId of product.categoryIds) {
        for (const categoryId of contributors.get(assignedId) ?? []) reached.add(categoryId)
      }
      for (const categoryId of reached) increment(raw.categories, categoryId)
    }
    if (category && type && options) {
      for (const tagId of product.tagIds) increment(raw.tags, tagId)
    }
    if (category && tags && options) increment(raw.productTypes, product.productType)
    if (!(category && tags && type)) continue
    for (const code of codes) {
      const values = new Set<string>()
      for (const variant of variantsOf(product)) {
        const value = variant.optionValues[code]
        if (value === undefined || !variantMatches(variant, selection.options, code)) continue
        values.add(value)
      }
      if (!values.size) continue
      const counts = raw.options.get(code) ?? new Map<string, number>()
      for (const value of values) increment(counts, value)
      raw.options.set(code, counts)
    }
  }
  return raw
}

function sortedTemplateIds(source: StorefrontFacetSource): string[] {
  return Array.from(source.templates.keys()).sort(compareCodeUnits)
}

/** The overlays the count-facet labels read, for the listing's single translation query (§7.2). */
export function storefrontFacetTranslationRequests(
  source: StorefrontFacetSource,
  raw: StorefrontRawCountFacets,
): Array<{ entityType: string; ids: string[] }> {
  return [
    { entityType: STOREFRONT_CATEGORY_ENTITY_TYPE, ids: Array.from(raw.categories.keys()) },
    { entityType: STOREFRONT_TAG_ENTITY_TYPE, ids: Array.from(raw.tags.keys()) },
    { entityType: STOREFRONT_OPTION_SCHEMA_ENTITY_TYPE, ids: sortedTemplateIds(source) },
  ]
}

export type StorefrontFacetLabelContext = {
  locales: string[]
  translations: Map<string, TranslationMap>
  assortmentScope: EffectiveAssortmentScope
  productTypeLabel: (type: string) => string
}

type OptionDefinitionRef = { templateId: string; option: CatalogProductOptionDefinition }

function optionDefinitions(source: StorefrontFacetSource): Map<string, OptionDefinitionRef> {
  const definitions = new Map<string, OptionDefinitionRef>()
  for (const templateId of sortedTemplateIds(source)) {
    for (const option of source.templates.get(templateId) ?? []) {
      if (!definitions.has(option.code)) definitions.set(option.code, { templateId, option })
    }
  }
  return definitions
}

function compareLabels(left: { label: string; code: string }, right: { label: string; code: string }): number {
  return left.label.localeCompare(right.label) || compareCodeUnits(left.code, right.code)
}

function productTypeRank(type: string): number {
  const index = (CATALOG_PRODUCT_TYPES as readonly string[]).indexOf(type)
  return index === -1 ? CATALOG_PRODUCT_TYPES.length : index
}

/**
 * Turns raw counts into the payload: categories that are active and inside the buyer's assortment,
 * with localized names (depth, then name order); tags with localized labels (count, then label);
 * options with the template's translated option and choice labels (choices in template order;
 * values no template defines fall back to the stored value); product types with catalog labels.
 * Only entries with a nonzero count are listed.
 */
export function labelStorefrontCountFacets(
  source: StorefrontFacetSource,
  raw: StorefrontRawCountFacets,
  context: StorefrontFacetLabelContext,
): StorefrontCountFacets {
  const { locales, translations } = context
  const categoryTranslations = translations.get(STOREFRONT_CATEGORY_ENTITY_TYPE)
  const tagTranslations = translations.get(STOREFRONT_TAG_ENTITY_TYPE)
  const templateTranslations = translations.get(STOREFRONT_OPTION_SCHEMA_ENTITY_TYPE)

  const categories: StorefrontCountFacets['categories'] = []
  for (const [id, count] of raw.categories) {
    const category = source.categories.get(id)
    if (!category || !category.isActive || count <= 0) continue
    const lineage = { id, ancestorIds: category.ancestorIds, descendantIds: category.descendantIds }
    if (!isCategoryInAssortment(lineage, context.assortmentScope)) continue
    categories.push({
      id,
      name: localize(category.name, categoryTranslations?.get(id), 'name', locales) ?? category.name,
      slug: category.slug,
      depth: category.depth,
      parentId: category.parentId,
      count,
    })
  }
  categories.sort(
    (left, right) => left.depth - right.depth || left.name.localeCompare(right.name) || compareCodeUnits(left.id, right.id),
  )

  const tags: StorefrontCountFacets['tags'] = []
  for (const [id, count] of raw.tags) {
    const tag = source.tags.get(id)
    if (!tag || !tag.slug || count <= 0) continue
    tags.push({ slug: tag.slug, label: localize(tag.label, tagTranslations?.get(id), 'label', locales) ?? tag.slug, count })
  }
  tags.sort(
    (left, right) => right.count - left.count || left.label.localeCompare(right.label) || compareCodeUnits(left.slug, right.slug),
  )

  const definitions = optionDefinitions(source)
  const options: StorefrontCountFacets['options'] = []
  for (const [code, counts] of raw.options) {
    const definition = definitions.get(code)
    const overlay = definition ? templateTranslations?.get(definition.templateId) : undefined
    const choices = Array.isArray(definition?.option.choices) ? definition.option.choices : []
    const values: Array<{ code: string; label: string; count: number; rank: number }> = []
    for (const [value, count] of counts) {
      if (count <= 0) continue
      let rank = choices.findIndex((choice) => choice.code === value)
      if (rank === -1) rank = choices.findIndex((choice) => choice.label === value)
      const choice = rank === -1 ? null : choices[rank]
      const label = choice
        ? localize(choice.label, overlay, optionChoiceLabelTranslationField(code, choice.code), locales) ?? value
        : value
      values.push({ code: value, label, count, rank: rank === -1 ? choices.length : rank })
    }
    if (!values.length) continue
    values.sort((left, right) => left.rank - right.rank || compareLabels(left, right))
    options.push({
      code,
      label: definition
        ? localize(definition.option.label, overlay, optionLabelTranslationField(code), locales) ?? code
        : code,
      values: values.map((value) => ({ code: value.code, label: value.label, count: value.count })),
    })
  }
  options.sort(compareLabels)

  const productTypes: StorefrontCountFacets['productTypes'] = []
  for (const [type, count] of raw.productTypes) {
    if (count <= 0) continue
    productTypes.push({ type, label: context.productTypeLabel(type), count })
  }
  productTypes.sort(
    (left, right) => productTypeRank(left.type) - productTypeRank(right.type) || compareCodeUnits(left.type, right.type),
  )

  return { categories, tags, options, productTypes }
}

/** Catalog product-type labels (`catalog.products.types.<type>`) in the response locale; the type code when untranslated. */
export async function loadStorefrontProductTypeLabeler(locale: string): Promise<(type: string) => string> {
  const translate = createFallbackTranslator(await loadDictionary(resolveSupportedLocale(locale) ?? defaultLocale))
  return (type) => translate(`${CATALOG_PRODUCT_TYPE_LABEL_PREFIX}${type}`, type)
}

/** `priceRange` over the amounts the price filter compares against (each product's from-price). */
export function storefrontPriceRangeFacet(
  amounts: Iterable<number | null>,
  currencyCode: string,
): StorefrontFacets['priceRange'] {
  let min: number | null = null
  let max: number | null = null
  for (const amount of amounts) {
    if (amount === null || !Number.isFinite(amount)) continue
    if (min === null || amount < min) min = amount
    if (max === null || amount > max) max = amount
  }
  return min === null || max === null ? null : { min, max, currencyCode }
}

const AVAILABILITY_STATE_ORDER: readonly AvailabilityState[] = [
  'in_stock',
  'low_stock',
  'backorder',
  'preorder',
  'not_tracked',
  'out_of_stock',
]

function availabilityRank(state: AvailabilityState): number {
  const index = AVAILABILITY_STATE_ORDER.indexOf(state)
  return index === -1 ? AVAILABILITY_STATE_ORDER.length : index
}

/** Page-scoped availability counts (D21): the states of the returned page before the availability filter. */
export function storefrontAvailabilityFacet(states: Iterable<AvailabilityState>): StorefrontFacets['availability'] {
  const counts = new Map<AvailabilityState, number>()
  for (const state of states) increment(counts, state)
  return Array.from(counts.entries())
    .map(([state, count]) => ({ state, count }))
    .sort((left, right) => availabilityRank(left.state) - availabilityRank(right.state))
}
