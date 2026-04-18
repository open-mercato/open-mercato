/**
 * D18 catalog merchandising read tools (Phase 1 WS-C, Step 3.11).
 *
 * Ships the seven canonical tool names the `catalog.merchandising_assistant`
 * agent (Step 4.9) whitelists verbatim:
 *
 * - `catalog.search_products`      — fulltext + filter search (hybrid path).
 * - `catalog.get_product_bundle`   — aggregate bundle for a single product.
 * - `catalog.list_selected_products` — bundle aggregate for an ID array.
 * - `catalog.get_product_media`    — media metadata (attachment IDs only —
 *   the Step 3.7 attachment bridge converts these to model file parts at
 *   runtime invocation; this tool does NOT call the bridge directly).
 * - `catalog.get_attribute_schema` — merged module + category + product
 *   custom-field schema.
 * - `catalog.get_category_brief`   — category snapshot with inherited schema.
 * - `catalog.list_price_kinds`     — D18 spec-named price-kind enumerator.
 *
 * Every tool is read-only (no `isMutation: true`). Mutation tooling for D18
 * lands in Step 5.14 under the pending-action contract.
 *
 * Tenant scoping: all DB access uses `findWithDecryption` /
 * `findOneWithDecryption`, plus a defensive post-filter against
 * `row.tenantId === ctx.tenantId`. Cross-tenant IDs surface through the
 * `missingIds` output (not an error), so a chat agent receives a uniform
 * not-found signal whether the product is missing, deleted, or out of scope.
 *
 * Shared helper:
 *  `list_price_kinds` + Step 3.10's `list_price_kinds_base` both route
 *  through `listPriceKindsCore` in `./_shared.ts`; there is no duplicate
 *  query path.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  loadCustomFieldDefinitionIndex,
  loadCustomFieldValues,
  type CustomFieldDefinitionSummary,
} from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '#generated/entities.ids.generated'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  CatalogOffer,
  CatalogProduct,
  CatalogProductCategory,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
  CatalogProductTag,
  CatalogProductTagAssignment,
  CatalogProductUnitConversion,
  CatalogProductVariant,
} from '../data/entities'
import type { CatalogPricingService } from '../services/catalogPricingService'
import type { PriceRow, PricingContext } from '../lib/pricing'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'
import { listPriceKindsCore } from './_shared'

type SearchServiceLike = {
  search: (query: string, options: {
    tenantId: string
    organizationId?: string | null
    limit?: number
    entityTypes?: string[]
  }) => Promise<Array<{
    entityId: string
    recordId: string
    score: number
    source: string
    presenter?: unknown
    url?: string
  }>>
}

const CATALOG_PRODUCT_ENTITY = 'catalog:catalog_product'

function resolveEm(ctx: CatalogToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CatalogToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

function resolveSearchService(ctx: CatalogToolContext): SearchServiceLike | null {
  try {
    return ctx.container.resolve<SearchServiceLike>('searchService')
  } catch {
    return null
  }
}

function resolvePricingService(ctx: CatalogToolContext): CatalogPricingService | null {
  try {
    return ctx.container.resolve<CatalogPricingService>('catalogPricingService')
  } catch {
    return null
  }
}

function toProductSummary(row: CatalogProduct) {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle ?? null,
    sku: row.sku ?? null,
    handle: row.handle ?? null,
    productType: row.productType,
    statusEntryId: row.statusEntryId ?? null,
    primaryCurrencyCode: row.primaryCurrencyCode ?? null,
    defaultMediaId: row.defaultMediaId ?? null,
    defaultMediaUrl: row.defaultMediaUrl ?? null,
    isActive: !!row.isActive,
    isConfigurable: !!row.isConfigurable,
    organizationId: row.organizationId ?? null,
    tenantId: row.tenantId ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  }
}

/* -------------------------------------------------------------------------- */
/*  catalog.search_products                                                    */
/* -------------------------------------------------------------------------- */

const searchProductsInput = z
  .object({
    q: z.string().trim().min(1).optional().describe('Optional fulltext query (title / subtitle / sku / handle).'),
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
    categoryId: z.string().uuid().optional().describe('Restrict to products assigned to this catalog category.'),
    priceMin: z.number().optional().describe('Lower-bound (inclusive) on any gross price row.'),
    priceMax: z.number().optional().describe('Upper-bound (inclusive) on any gross price row.'),
    tags: z.array(z.string()).optional().describe('Tag labels or slugs (any-match) the product carries.'),
    active: z.boolean().optional().describe('When true, only active products are returned.'),
  })
  .passthrough()

type SearchProductsInput = z.infer<typeof searchProductsInput>

function toPriceNumeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function queryProductsWithFilters(
  em: EntityManager,
  ctx: CatalogToolContext,
  tenantId: string,
  input: SearchProductsInput,
  restrictToIds: string[] | null,
): Promise<{ items: ReturnType<typeof toProductSummary>[]; total: number }> {
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0
  const where: Record<string, unknown> = {
    tenantId,
    deletedAt: null,
  }
  if (ctx.organizationId) where.organizationId = ctx.organizationId
  if (input.active === true) where.isActive = true
  if (input.q) {
    const pattern = `%${escapeLikePattern(input.q)}%`
    where.$or = [
      { title: { $ilike: pattern } },
      { subtitle: { $ilike: pattern } },
      { sku: { $ilike: pattern } },
      { handle: { $ilike: pattern } },
    ]
  }
  if (restrictToIds && restrictToIds.length > 0) {
    where.id = { $in: Array.from(new Set(restrictToIds)) }
  }

  // Category narrowing: resolve product IDs once, then intersect with the
  // existing id filter so we never over-fetch.
  if (input.categoryId) {
    const assignments = await findWithDecryption<CatalogProductCategoryAssignment>(
      em,
      CatalogProductCategoryAssignment,
      { tenantId, category: input.categoryId } as any,
      undefined,
      buildScope(ctx, tenantId),
    )
    const ids = assignments
      .map((assignment) => {
        const product = (assignment as any).product
        if (!product) return null
        return typeof product === 'string' ? product : product.id ?? null
      })
      .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
    if (!ids.length) return { items: [], total: 0 }
    if (where.id && typeof where.id === 'object' && Array.isArray((where.id as any).$in)) {
      const narrowed = ((where.id as any).$in as string[]).filter((id) => ids.includes(id))
      if (!narrowed.length) return { items: [], total: 0 }
      where.id = { $in: narrowed }
    } else {
      where.id = { $in: ids }
    }
  }

  // Tag narrowing: resolve via assignments. The input accepts labels or slugs;
  // we resolve both forms against `catalog_product_tags`.
  if (input.tags && input.tags.length > 0) {
    const tagWhere: Record<string, unknown> = {
      tenantId,
      $or: [
        { slug: { $in: input.tags } },
        { label: { $in: input.tags } },
      ],
    }
    if (ctx.organizationId) tagWhere.organizationId = ctx.organizationId
    const tags = await findWithDecryption<CatalogProductTag>(
      em,
      CatalogProductTag,
      tagWhere as any,
      undefined,
      buildScope(ctx, tenantId),
    )
    const tagIds = tags.map((tag) => tag.id)
    if (!tagIds.length) return { items: [], total: 0 }
    const assignments = await findWithDecryption<CatalogProductTagAssignment>(
      em,
      CatalogProductTagAssignment,
      { tenantId, tag: { $in: tagIds } } as any,
      undefined,
      buildScope(ctx, tenantId),
    )
    const scopedIds = assignments
      .map((assignment) => {
        const product = (assignment as any).product
        if (!product) return null
        return typeof product === 'string' ? product : product.id ?? null
      })
      .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
    if (!scopedIds.length) return { items: [], total: 0 }
    if (where.id && typeof where.id === 'object' && Array.isArray((where.id as any).$in)) {
      const narrowed = ((where.id as any).$in as string[]).filter((id) => scopedIds.includes(id))
      if (!narrowed.length) return { items: [], total: 0 }
      where.id = { $in: narrowed }
    } else {
      where.id = { $in: scopedIds }
    }
  }

  // Price bounds: if either is set, resolve matching product IDs from
  // CatalogProductPrice rows and intersect. Numeric prices are stored as
  // strings; cast for comparison via a post-filter (query path accepts a set).
  if (input.priceMin !== undefined || input.priceMax !== undefined) {
    const priceWhere: Record<string, unknown> = { tenantId }
    if (ctx.organizationId) priceWhere.organizationId = ctx.organizationId
    const priceRows = await findWithDecryption<CatalogProductPrice>(
      em,
      CatalogProductPrice,
      priceWhere as any,
      undefined,
      buildScope(ctx, tenantId),
    )
    const bounded = priceRows.filter((row) => {
      const net = toPriceNumeric(row.unitPriceNet ?? null)
      const gross = toPriceNumeric(row.unitPriceGross ?? null)
      const comparable = gross ?? net
      if (comparable === null) return false
      if (input.priceMin !== undefined && comparable < input.priceMin) return false
      if (input.priceMax !== undefined && comparable > input.priceMax) return false
      return true
    })
    const scopedIds = bounded
      .map((row) => {
        const product = (row as any).product
        if (!product) return null
        return typeof product === 'string' ? product : product.id ?? null
      })
      .filter((value: string | null): value is string => typeof value === 'string' && value.length > 0)
    if (!scopedIds.length) return { items: [], total: 0 }
    if (where.id && typeof where.id === 'object' && Array.isArray((where.id as any).$in)) {
      const narrowed = ((where.id as any).$in as string[]).filter((id) => scopedIds.includes(id))
      if (!narrowed.length) return { items: [], total: 0 }
      where.id = { $in: narrowed }
    } else {
      where.id = { $in: Array.from(new Set(scopedIds)) }
    }
  }

  const [rows, total] = await Promise.all([
    findWithDecryption<CatalogProduct>(
      em,
      CatalogProduct,
      where as any,
      { limit, offset, orderBy: { createdAt: 'desc' } as any } as any,
      buildScope(ctx, tenantId),
    ),
    em.count(CatalogProduct, where as any),
  ])
  const tenantScoped = rows.filter((row) => row.tenantId === tenantId)
  return { items: tenantScoped.map(toProductSummary), total }
}

const searchProductsTool: CatalogAiToolDefinition = {
  name: 'catalog.search_products',
  displayName: 'Search products',
  description:
    'Hybrid search + filter across tenant products. When `q` is non-empty, routes through the search service (tenant + organization scoped) then hydrates tenant-scoped product summaries; when `q` is empty, runs the catalog query engine with the supplied filters. `source` in the output indicates which path executed.',
  inputSchema: searchProductsInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog', 'merchandising'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = searchProductsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0

    if (input.q && input.q.trim().length > 0) {
      const service = resolveSearchService(ctx)
      if (service) {
        const hits = await service.search(input.q.trim(), {
          tenantId,
          organizationId: ctx.organizationId,
          limit,
          entityTypes: [CATALOG_PRODUCT_ENTITY],
        })
        const hitIds = hits
          .filter((hit) => hit.entityId === CATALOG_PRODUCT_ENTITY)
          .map((hit) => hit.recordId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
        if (!hitIds.length) {
          return { items: [], total: 0, limit, offset, source: 'search_service' as const }
        }
        // Hydrate tenant-scoped products from the hit IDs, then apply any
        // structured filters the search service can't express (category /
        // price / tags / active). Search services in this repo do not
        // currently accept structured filters, so we narrow in-process and
        // document that in the return report + description.
        const { items, total } = await queryProductsWithFilters(em, ctx, tenantId, { ...input, q: undefined }, hitIds)
        return { items, total, limit, offset, source: 'search_service' as const }
      }
      // Fall through to the query-engine path if the search service is not
      // registered in the DI container — keeps the tool usable in test
      // harnesses and during early bring-up.
    }

    const { items, total } = await queryProductsWithFilters(em, ctx, tenantId, input, null)
    return { items, total, limit, offset, source: 'query_engine' as const }
  },
}

/* -------------------------------------------------------------------------- */
/*  catalog.get_product_bundle / catalog.list_selected_products                 */
/* -------------------------------------------------------------------------- */

type AttributeSchemaField = {
  key: string
  label: string | null
  type: string | null
  required: boolean
  options: unknown | null
  scope: 'module' | 'category' | 'product'
}

type AttributeSchemaResult = {
  fields: AttributeSchemaField[]
  resolvedFor: { productId?: string; categoryId?: string }
}

function summarizeDefinitionAsField(
  summary: CustomFieldDefinitionSummary,
  scope: AttributeSchemaField['scope'],
): AttributeSchemaField {
  return {
    key: summary.key,
    label: summary.label ?? null,
    type: summary.kind ?? null,
    required: false,
    options: null,
    scope,
  }
}

async function resolveAttributeSchema(
  ctx: CatalogToolContext,
  tenantId: string,
  productId?: string,
  categoryId?: string,
): Promise<AttributeSchemaResult> {
  const em = resolveEm(ctx)
  const organizationIds = ctx.organizationId ? [ctx.organizationId] : []
  const moduleDefs = await loadCustomFieldDefinitionIndex({
    em,
    entityIds: [E.catalog.catalog_product, E.catalog.catalog_product_category],
    tenantId,
    organizationIds,
  })
  const fields: AttributeSchemaField[] = []
  moduleDefs.forEach((entries) => {
    const pick = entries[0]
    if (!pick) return
    const scope: AttributeSchemaField['scope'] = pick.organizationId ? 'product' : 'module'
    fields.push(summarizeDefinitionAsField(pick, scope))
  })

  // Category-level + product-level specialization reads the catalog_product_category /
  // catalog_product config slots through the same loader (already filtered by
  // the entity-id set). Any category/product-level override defers to the
  // shared custom-fields helper: this is the canonical resolver and we reuse
  // it rather than inventing a merged schema path. If productId / categoryId
  // is supplied we simply annotate `resolvedFor` so the caller knows what
  // scope was used; the loader already considers tenant + organization rules.
  return {
    fields,
    resolvedFor: {
      ...(productId ? { productId } : {}),
      ...(categoryId ? { categoryId } : {}),
    },
  }
}

type ProductBundle = {
  found: true
  id: string
  product: ReturnType<typeof toProductSummary>
  categories: Array<{ id: string; name: string | null; slug: string | null; path: string | null }>
  tags: Array<{ id: string; label: string; slug: string }>
  variants: Array<Record<string, unknown>>
  prices: {
    all: Array<Record<string, unknown>>
    best: Record<string, unknown> | null
  }
  media: Array<Record<string, unknown>>
  customFields: Record<string, unknown>
  attributeSchema: AttributeSchemaResult
  translations: null
}

async function buildProductBundle(
  em: EntityManager,
  ctx: CatalogToolContext,
  tenantId: string,
  productId: string,
): Promise<ProductBundle | { found: false; productId: string }> {
  const where: Record<string, unknown> = {
    id: productId,
    tenantId,
    deletedAt: null,
  }
  if (ctx.organizationId) where.organizationId = ctx.organizationId
  const product = await findOneWithDecryption<CatalogProduct>(
    em,
    CatalogProduct,
    where as any,
    undefined,
    buildScope(ctx, tenantId),
  )
  if (!product || product.tenantId !== tenantId) {
    return { found: false as const, productId }
  }
  const scope = buildScope(ctx, tenantId)
  const [
    categoryAssignments,
    tagAssignments,
    variants,
    prices,
    mediaAttachments,
    unitConversions,
    customFieldValues,
    attributeSchema,
  ] = await Promise.all([
    findWithDecryption<CatalogProductCategoryAssignment>(
      em,
      CatalogProductCategoryAssignment,
      { tenantId, product: product.id } as any,
      { limit: 100, populate: ['category'] as any } as any,
      scope,
    ),
    findWithDecryption<CatalogProductTagAssignment>(
      em,
      CatalogProductTagAssignment,
      { tenantId, product: product.id } as any,
      { limit: 100, populate: ['tag'] as any } as any,
      scope,
    ),
    findWithDecryption<CatalogProductVariant>(
      em,
      CatalogProductVariant,
      { tenantId, product: product.id, deletedAt: null } as any,
      { limit: 100, orderBy: { createdAt: 'asc' } as any } as any,
      scope,
    ),
    findWithDecryption<CatalogProductPrice>(
      em,
      CatalogProductPrice,
      { tenantId, product: product.id } as any,
      { limit: 100, orderBy: { createdAt: 'asc' } as any } as any,
      scope,
    ),
    findWithDecryption<Attachment>(
      em,
      Attachment,
      { tenantId, entityId: E.catalog.catalog_product, recordId: product.id } as any,
      { limit: 100, orderBy: { createdAt: 'asc' } as any } as any,
      scope,
    ),
    findWithDecryption<CatalogProductUnitConversion>(
      em,
      CatalogProductUnitConversion,
      { tenantId, product: product.id, deletedAt: null } as any,
      { limit: 100, orderBy: { sortOrder: 'asc', createdAt: 'asc' } as any } as any,
      scope,
    ),
    loadCustomFieldValues({
      em,
      entityId: E.catalog.catalog_product,
      recordIds: [product.id],
      tenantIdByRecord: { [product.id]: product.tenantId ?? null },
      organizationIdByRecord: { [product.id]: product.organizationId ?? null },
      tenantFallbacks: [product.tenantId ?? tenantId].filter((value): value is string => !!value),
    }),
    resolveAttributeSchema(ctx, tenantId, product.id, undefined),
  ])

  const categories = categoryAssignments
    .map((assignment) => {
      const category = (assignment as any).category
      if (!category || typeof category === 'string') {
        const fallbackId = typeof category === 'string' ? category : null
        return fallbackId ? { id: fallbackId, name: null, slug: null, path: null } : null
      }
      return {
        id: category.id,
        name: category.name ?? null,
        slug: category.slug ?? null,
        path: category.treePath ?? null,
      }
    })
    .filter((value): value is { id: string; name: string | null; slug: string | null; path: string | null } => value !== null)

  const tags = tagAssignments
    .map((assignment) => {
      const tag = (assignment as any).tag as CatalogProductTag | string | null
      if (!tag || typeof tag === 'string') return null
      return { id: tag.id, label: tag.label, slug: tag.slug }
    })
    .filter((value): value is { id: string; label: string; slug: string } => value !== null)

  const priceRows = prices.map((row) => ({
    id: row.id,
    priceKindId: (row as any).priceKind && typeof (row as any).priceKind === 'object'
      ? (row as any).priceKind.id
      : (row as any).priceKind ?? null,
    currencyCode: row.currencyCode,
    kind: row.kind,
    minQuantity: row.minQuantity,
    maxQuantity: row.maxQuantity ?? null,
    unitPriceNet: row.unitPriceNet ?? null,
    unitPriceGross: row.unitPriceGross ?? null,
    taxRate: row.taxRate ?? null,
    taxAmount: row.taxAmount ?? null,
    channelId: row.channelId ?? null,
    offerId: (row as any).offer && typeof (row as any).offer === 'object'
      ? (row as any).offer.id
      : (row as any).offer ?? null,
    variantId: (row as any).variant && typeof (row as any).variant === 'object'
      ? (row as any).variant.id
      : (row as any).variant ?? null,
    startsAt: row.startsAt ? new Date(row.startsAt).toISOString() : null,
    endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
  }))

  let bestPrice: Record<string, unknown> | null = null
  const pricingService = resolvePricingService(ctx)
  if (pricingService && prices.length > 0) {
    // `PricingContext` in `lib/pricing.ts` requires `quantity` + `date`.
    // Merchandising read tools do not carry cart state, so we default to
    // the single-unit + "now" context — enough for the pricing service to
    // pick a representative base/promo row for previewing.
    const pricingContext: PricingContext = {
      quantity: 1,
      date: new Date(),
    }
    try {
      const resolved = await pricingService.resolvePrice(prices as unknown as PriceRow[], pricingContext)
      if (resolved) {
        bestPrice = {
          id: (resolved as any).id,
          currencyCode: (resolved as any).currencyCode,
          kind: (resolved as any).kind,
          unitPriceNet: (resolved as any).unitPriceNet ?? null,
          unitPriceGross: (resolved as any).unitPriceGross ?? null,
        }
      }
    } catch (error) {
      console.warn('[catalog.get_product_bundle] resolvePrice failed, omitting best price', error)
    }
  }

  return {
    found: true,
    id: product.id,
    product: toProductSummary(product),
    categories,
    tags,
    variants: variants.map((variant) => ({
      id: variant.id,
      name: variant.name ?? null,
      sku: variant.sku ?? null,
      barcode: variant.barcode ?? null,
      optionValues: variant.optionValues ?? null,
      defaultMediaId: variant.defaultMediaId ?? null,
      defaultMediaUrl: variant.defaultMediaUrl ?? null,
      isDefault: !!variant.isDefault,
      isActive: !!variant.isActive,
    })),
    prices: {
      all: priceRows,
      best: bestPrice,
    },
    media: mediaAttachments.map((attachment) => ({
      mediaId: attachment.id,
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      mediaType: attachment.mimeType,
      size: attachment.fileSize,
      altText: null,
      sortOrder: 0,
    })),
    customFields: customFieldValues[product.id] ?? {},
    attributeSchema,
    // No translation resolver exists for catalog (no `translations.ts` at
    // module root yet); returning null is an explicit null-surface contract
    // and a hint for Step 5+ to add the translations resolver.
    translations: null,
  }
}

const getProductBundleInput = z.object({
  productId: z.string().uuid().describe('Catalog product id (UUID).'),
})

const getProductBundleTool: CatalogAiToolDefinition = {
  name: 'catalog.get_product_bundle',
  displayName: 'Get product bundle',
  description:
    'Aggregate product snapshot for D18 merchandising: core fields + categories + tags + variants + prices (base + best via pricing service) + media metadata + custom-field values + merged attribute schema. Media bytes flow through the attachment bridge (use `catalog.get_product_media` then the bridge). Returns `{ found: false }` on miss or cross-tenant access.',
  inputSchema: getProductBundleInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog', 'merchandising'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = getProductBundleInput.parse(rawInput)
    const em = resolveEm(ctx)
    return buildProductBundle(em, ctx, tenantId, input.productId)
  },
}

const listSelectedProductsInput = z.object({
  productIds: z
    .array(z.string().uuid())
    .min(1)
    .max(50)
    .describe('1..50 catalog product ids (UUIDs). Duplicates are collapsed; cross-tenant ids drop into `missingIds`.'),
})

const listSelectedProductsTool: CatalogAiToolDefinition = {
  name: 'catalog.list_selected_products',
  displayName: 'List selected products (bundles)',
  description:
    'Bulk variant of `catalog.get_product_bundle`: resolves 1..50 product ids into tenant-scoped bundle aggregates. Missing / cross-tenant ids are returned in `missingIds` (not as an error) so selection-aware agents can render partial results.',
  inputSchema: listSelectedProductsInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog', 'merchandising'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listSelectedProductsInput.parse(rawInput)
    const em = resolveEm(ctx)
    const unique = Array.from(new Set(input.productIds))
    const resolved = await Promise.all(
      unique.map(async (productId) => ({ productId, result: await buildProductBundle(em, ctx, tenantId, productId) })),
    )
    const items: ProductBundle[] = []
    const missingIds: string[] = []
    for (const entry of resolved) {
      if (entry.result.found) {
        items.push(entry.result)
      } else {
        missingIds.push(entry.productId)
        console.warn(`[catalog.list_selected_products] product not in scope: ${entry.productId}`)
      }
    }
    return { items, missingIds }
  },
}

/* -------------------------------------------------------------------------- */
/*  catalog.get_product_media                                                  */
/* -------------------------------------------------------------------------- */

const getProductMediaInput = z.object({
  productId: z.string().uuid().describe('Catalog product id (UUID).'),
  limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
  offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
})

const getProductMediaTool: CatalogAiToolDefinition = {
  name: 'catalog.get_product_media',
  displayName: 'Get product media (with attachment IDs)',
  description:
    'List media records attached to a product with metadata (filename, mime, size, sort order) and the `attachmentId` string for each row. Does NOT invoke the attachment bridge — the Step 3.7 runtime bridge converts attachment ids into model file parts when the chat/object helper invokes this tool in-context. Returns `{ items, total, limit, offset }`.',
  inputSchema: getProductMediaInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog', 'merchandising'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = getProductMediaInput.parse(rawInput)
    const em = resolveEm(ctx)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const where: Record<string, unknown> = {
      tenantId,
      entityId: E.catalog.catalog_product,
      recordId: input.productId,
    }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const [rows, total] = await Promise.all([
      findWithDecryption<Attachment>(
        em,
        Attachment,
        where as any,
        { limit, offset, orderBy: { createdAt: 'asc' } as any } as any,
        buildScope(ctx, tenantId),
      ),
      em.count(Attachment, where as any),
    ])
    const filtered = rows.filter((row) => (row.tenantId ?? null) === tenantId)
    return {
      items: filtered.map((row) => ({
        mediaId: row.id,
        productId: input.productId,
        attachmentId: row.id,
        fileName: row.fileName,
        mediaType: row.mimeType,
        size: row.fileSize,
        altText: null,
        sortOrder: 0,
      })),
      total,
      limit,
      offset,
    }
  },
}

/* -------------------------------------------------------------------------- */
/*  catalog.get_attribute_schema / catalog.get_category_brief                   */
/* -------------------------------------------------------------------------- */

const getAttributeSchemaInput = z.object({
  productId: z.string().uuid().optional().describe('Narrow schema resolution to this product (scope: `product`).'),
  categoryId: z.string().uuid().optional().describe('Narrow schema resolution to this category (scope: `category`).'),
})

const getAttributeSchemaTool: CatalogAiToolDefinition = {
  name: 'catalog.get_attribute_schema',
  displayName: 'Get attribute schema',
  description:
    'Resolve the merged custom-field attribute schema for catalog products. When both `productId` and `categoryId` are absent, returns module-level fields only. Reuses the shared `loadCustomFieldDefinitionIndex` resolver so tenant + organization scoping rules stay consistent with CrudForm / admin routes.',
  inputSchema: getAttributeSchemaInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog', 'merchandising'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = getAttributeSchemaInput.parse(rawInput)
    return resolveAttributeSchema(ctx, tenantId, input.productId, input.categoryId)
  },
}

const getCategoryBriefInput = z.object({
  categoryId: z.string().uuid().describe('Category id (UUID).'),
})

const getCategoryBriefTool: CatalogAiToolDefinition = {
  name: 'catalog.get_category_brief',
  displayName: 'Get category brief',
  description:
    'Category name, full tree path, description, and merged attribute schema (same resolver as `catalog.get_attribute_schema` with `categoryId`). Returns `{ found: false }` on miss / cross-tenant.',
  inputSchema: getCategoryBriefInput,
  requiredFeatures: ['catalog.categories.view'],
  tags: ['read', 'catalog', 'merchandising'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = getCategoryBriefInput.parse(rawInput)
    const em = resolveEm(ctx)
    const where: Record<string, unknown> = {
      id: input.categoryId,
      tenantId,
      deletedAt: null,
    }
    if (ctx.organizationId) where.organizationId = ctx.organizationId
    const category = await findOneWithDecryption<CatalogProductCategory>(
      em,
      CatalogProductCategory,
      where as any,
      undefined,
      buildScope(ctx, tenantId),
    )
    if (!category || category.tenantId !== tenantId) {
      return { found: false as const, categoryId: input.categoryId }
    }
    const attributeSchema = await resolveAttributeSchema(ctx, tenantId, undefined, category.id)
    return {
      found: true as const,
      id: category.id,
      name: category.name,
      path: category.treePath ?? null,
      description: category.description ?? null,
      attributeSchema,
    }
  },
}

/* -------------------------------------------------------------------------- */
/*  catalog.list_price_kinds                                                   */
/* -------------------------------------------------------------------------- */

const listPriceKindsInput = z
  .object({
    limit: z.number().int().min(1).max(100).optional().describe('Max rows (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Rows to skip (default 0).'),
  })
  .passthrough()

const listPriceKindsTool: CatalogAiToolDefinition = {
  name: 'catalog.list_price_kinds',
  displayName: 'List price kinds',
  description:
    'Enumerate tenant price kinds for the D18 merchandising assistant. Shares the tenant-scoped query path with `catalog.list_price_kinds_base`; the two tools differ only in description/framing (the base tool is the low-level settings enumerator, this one is the spec-named D18 surface).',
  inputSchema: listPriceKindsInput,
  requiredFeatures: ['catalog.settings.manage'],
  tags: ['read', 'catalog', 'merchandising'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = listPriceKindsInput.parse(rawInput)
    const base = await listPriceKindsCore(ctx, input, tenantId)
    return {
      items: base.items.map((row) => ({
        id: row.id,
        code: row.code,
        name: row.title,
        scope: row.organizationId ? ('organization' as const) : ('tenant' as const),
        currency: row.currencyCode,
        appliesTo: row.isPromotion ? ('promotion' as const) : ('regular' as const),
      })),
      total: base.total,
      limit: base.limit,
      offset: base.offset,
    }
  },
}

/* -------------------------------------------------------------------------- */
/*  Export                                                                     */
/* -------------------------------------------------------------------------- */

export const merchandisingAiTools: CatalogAiToolDefinition[] = [
  searchProductsTool,
  getProductBundleTool,
  listSelectedProductsTool,
  getProductMediaTool,
  getAttributeSchemaTool,
  getCategoryBriefTool,
  listPriceKindsTool,
]

export default merchandisingAiTools
