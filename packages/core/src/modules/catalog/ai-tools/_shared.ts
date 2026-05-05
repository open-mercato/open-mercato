/**
 * Shared helpers for catalog AI tool packs (Phase 1 WS-C, Steps 3.10 / 3.11 / 3.12).
 *
 * Step 3.10/3.11 centralized the price-kind enumeration query used by both the
 * base tool (`catalog.list_price_kinds_base`) and the D18 spec-named tool
 * (`catalog.list_price_kinds`).
 *
 * Step 3.12 lifts the **product-bundle builder** (and the merged
 * attribute-schema resolver) here too, so the D18 AI-authoring tools
 * (`draft_description_from_attributes`, `extract_attributes_from_description`,
 * `draft_description_from_media`, `suggest_title_variants`,
 * `suggest_price_adjustment`) can reuse them verbatim without either
 * duplicating the logic or depending on an internal symbol in
 * `merchandising-pack.ts`. Both packs (`merchandising-pack.ts` and
 * `authoring-pack.ts`) consume these helpers; neither pack owns the bundle
 * loader any more.
 *
 * Keeping the shared pieces query-shaped (not tool-shaped) means each tool is
 * free to project its own output shape without leaking concerns between packs.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import {
  loadCustomFieldDefinitionIndex,
  loadCustomFieldValues,
  type CustomFieldDefinitionSummary,
} from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '#generated/entities.ids.generated'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductCategoryAssignment,
  CatalogProductPrice,
  CatalogProductTag,
  CatalogProductTagAssignment,
  CatalogProductUnitConversion,
  CatalogProductVariant,
} from '../data/entities'
import type { CatalogPricingService } from '../services/catalogPricingService'
import type { PriceRow, PricingContext } from '../lib/pricing'
import type { CatalogToolContext } from './types'

/* -------------------------------------------------------------------------- */
/*  Price-kind enumeration shared core                                         */
/* -------------------------------------------------------------------------- */

export type ListPriceKindsCoreInput = {
  limit?: number
  offset?: number
}

export type ListPriceKindsCoreRow = {
  id: string
  code: string
  title: string
  displayMode: string
  currencyCode: string | null
  isPromotion: boolean
  isActive: boolean
  organizationId: string | null
  tenantId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type ListPriceKindsCoreResult = {
  items: ListPriceKindsCoreRow[]
  total: number
  limit: number
  offset: number
}

export function resolveEm(ctx: CatalogToolContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

export function buildScope(ctx: CatalogToolContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

/**
 * Shared tenant-scoped enumeration of `CatalogPriceKind` rows.
 *
 * Uses `findWithDecryption` + post-filter. Price kinds are tenant-owned and
 * can be either organization-scoped (match `ctx.organizationId`) or
 * null-scoped (shared across the tenant); the `$or` below mirrors the
 * filter the base tool used pre-refactor so behavior stays identical.
 */
export async function listPriceKindsCore(
  ctx: CatalogToolContext,
  input: ListPriceKindsCoreInput,
  tenantId: string,
): Promise<ListPriceKindsCoreResult> {
  const em = resolveEm(ctx)
  const limit = input.limit ?? 50
  const offset = input.offset ?? 0
  const where: Record<string, unknown> = { tenantId, deletedAt: null }
  if (ctx.organizationId) {
    where.$or = [{ organizationId: ctx.organizationId }, { organizationId: null }]
  }
  const [rows, total] = await Promise.all([
    findWithDecryption<CatalogPriceKind>(
      em,
      CatalogPriceKind,
      where as any,
      { limit, offset, orderBy: { code: 'asc' } as any } as any,
      buildScope(ctx, tenantId),
    ),
    em.count(CatalogPriceKind, where as any),
  ])
  const filtered = rows.filter((row) => row.tenantId === tenantId)
  return {
    items: filtered.map((row) => ({
      id: row.id,
      code: row.code,
      title: row.title,
      displayMode: row.displayMode,
      currencyCode: row.currencyCode ?? null,
      isPromotion: !!row.isPromotion,
      isActive: !!row.isActive,
      organizationId: row.organizationId ?? null,
      tenantId: row.tenantId ?? null,
      createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    })),
    total,
    limit,
    offset,
  }
}

/* -------------------------------------------------------------------------- */
/*  Product summary + bundle builder                                           */
/* -------------------------------------------------------------------------- */

export type ProductSummary = {
  id: string
  title: string
  subtitle: string | null
  sku: string | null
  handle: string | null
  productType: string
  statusEntryId: string | null
  primaryCurrencyCode: string | null
  defaultMediaId: string | null
  defaultMediaUrl: string | null
  /**
   * Alias of `defaultMediaUrl`. Surfaced under the same key the
   * `open-mercato:product` record card consumes so the model can pass it
   * straight through without renaming. Null when the product has no
   * default media.
   */
  imageUrl: string | null
  isActive: boolean
  isConfigurable: boolean
  organizationId: string | null
  tenantId: string | null
  createdAt: string | null
  updatedAt: string | null
  description: string | null
}

export function toProductSummary(row: CatalogProduct): ProductSummary {
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
    imageUrl: row.defaultMediaUrl ?? null,
    isActive: !!row.isActive,
    isConfigurable: !!row.isConfigurable,
    organizationId: row.organizationId ?? null,
    tenantId: row.tenantId ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    // `description` is a product field used by D18 authoring tools to seed
    // extract-attributes-from-description; falls back to null when absent.
    description: (row as any).description ?? null,
  }
}

export function toPriceNumeric(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export type AttributeSchemaField = {
  key: string
  label: string | null
  type: string | null
  required: boolean
  options: unknown | null
  scope: 'module' | 'category' | 'product'
}

export type AttributeSchemaResult = {
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

export async function resolveAttributeSchema(
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
  return {
    fields,
    resolvedFor: {
      ...(productId ? { productId } : {}),
      ...(categoryId ? { categoryId } : {}),
    },
  }
}

export type ProductBundleMediaEntry = {
  mediaId: string
  attachmentId: string
  fileName: string
  mediaType: string | null
  size: number | null
  altText: string | null
  sortOrder: number
}

export type ProductBundle = {
  found: true
  id: string
  product: ProductSummary
  categories: Array<{ id: string; name: string | null; slug: string | null; path: string | null }>
  tags: Array<{ id: string; label: string; slug: string }>
  variants: Array<Record<string, unknown>>
  prices: {
    all: Array<Record<string, unknown>>
    best: Record<string, unknown> | null
  }
  media: ProductBundleMediaEntry[]
  customFields: Record<string, unknown>
  attributeSchema: AttributeSchemaResult
  translations: null
}

export type ProductBundleResult = ProductBundle | { found: false; productId: string }

function resolvePricingService(ctx: CatalogToolContext): CatalogPricingService | null {
  try {
    return ctx.container.resolve<CatalogPricingService>('catalogPricingService')
  } catch {
    return null
  }
}

export async function buildProductBundle(
  em: EntityManager,
  ctx: CatalogToolContext,
  tenantId: string,
  productId: string,
): Promise<ProductBundleResult> {
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
