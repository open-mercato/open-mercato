/**
 * `catalog.list_products` + `catalog.get_product` (Phase 1 WS-C, Step 3.10).
 *
 * Read-only tools scoped to `ctx.tenantId` + `ctx.organizationId`. Mutation
 * tools are deferred to Step 5.14 under the pending-action contract.
 *
 * Phase 3b of `.ai/specs/2026-04-27-ai-tools-api-backed-dry-refactor.md`:
 * `catalog.list_products` is now an API-backed wrapper over
 * `GET /api/catalog/products`. Tool name, schema, requiredFeatures, and
 * output shape are unchanged.
 */
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import { defineApiBackedAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/api-backed-tool'
import type {
  AiApiOperationRequest,
  AiToolExecutionContext,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-api-operation-runner'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadCustomFieldValues } from '@open-mercato/shared/lib/crud/custom-fields'
import { E } from '#generated/entities.ids.generated'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import {
  CatalogProduct,
  CatalogProductCategoryAssignment,
  CatalogProductTagAssignment,
  CatalogProductTag,
  CatalogProductVariant,
  CatalogProductPrice,
  CatalogProductUnitConversion,
} from '../data/entities'
import { assertTenantScope, type CatalogAiToolDefinition, type CatalogToolContext } from './types'

function resolveEm(ctx: CatalogToolContext | AiToolExecutionContext): EntityManager {
  return ctx.container.resolve<EntityManager>('em')
}

function buildScope(ctx: CatalogToolContext | AiToolExecutionContext, tenantId: string) {
  return { tenantId, organizationId: ctx.organizationId }
}

const listProductsInput = z
  .object({
    q: z.string().trim().min(1).optional().describe('Optional search text matched against title / subtitle / sku / handle.'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum rows to return (default 50, max 100).'),
    offset: z.number().int().min(0).optional().describe('Number of rows to skip (default 0).'),
    categoryId: z.string().uuid().optional().describe('Restrict to products assigned to this catalog category.'),
    tagIds: z.array(z.string().uuid()).optional().describe('Restrict to products carrying at least one of these tag ids.'),
    active: z.boolean().optional().describe('When true, only active (not archived) products are returned.'),
  })
  .passthrough()

type ListProductsInput = z.infer<typeof listProductsInput>

type ListProductsApiItem = {
  id?: string
  title?: string | null
  subtitle?: string | null
  sku?: string | null
  handle?: string | null
  product_type?: string | null
  productType?: string | null
  status_entry_id?: string | null
  statusEntryId?: string | null
  primary_currency_code?: string | null
  primaryCurrencyCode?: string | null
  default_media_id?: string | null
  defaultMediaId?: string | null
  default_media_url?: string | null
  defaultMediaUrl?: string | null
  is_active?: boolean | null
  isActive?: boolean | null
  is_configurable?: boolean | null
  isConfigurable?: boolean | null
  organization_id?: string | null
  organizationId?: string | null
  tenant_id?: string | null
  tenantId?: string | null
  created_at?: string | null
  createdAt?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

type ListProductsApiResponse = {
  items?: ListProductsApiItem[]
  total?: number
}

type ListProductsOutput = {
  items: Array<Record<string, unknown>>
  total: number
  limit: number
  offset: number
}

const listProductsTool = defineApiBackedAiTool<
  ListProductsInput,
  ListProductsApiResponse,
  ListProductsOutput
>({
  name: 'catalog.list_products',
  displayName: 'List products',
  description:
    'Search / list catalog products for the caller tenant + organization. Returns { items, total, limit, offset }.',
  inputSchema: listProductsInput,
  requiredFeatures: ['catalog.products.view'],
  toOperation: (input, ctx) => {
    assertTenantScope(ctx as unknown as CatalogToolContext)
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const page = Math.floor(offset / limit) + 1

    const query: Record<string, string | number | boolean | null | undefined> = {
      page,
      pageSize: limit,
    }
    if (input.q?.trim()) query.search = input.q.trim()
    if (input.categoryId) query.categoryIds = input.categoryId
    if (input.tagIds && input.tagIds.length > 0) query.tagIds = input.tagIds.join(',')
    if (input.active === true) query.isActive = 'true'

    const operation: AiApiOperationRequest = {
      method: 'GET',
      path: '/catalog/products',
      query,
    }
    return operation
  },
  mapResponse: (response, input) => {
    const limit = input.limit ?? 50
    const offset = input.offset ?? 0
    const data = (response.data ?? {}) as ListProductsApiResponse
    const rawItems: ListProductsApiItem[] = Array.isArray(data.items) ? data.items : []
    return {
      items: rawItems.map((row) => {
        const createdAtRaw = row.created_at ?? row.createdAt ?? null
        const createdAt = createdAtRaw ? new Date(String(createdAtRaw)).toISOString() : null
        const updatedAtRaw = row.updated_at ?? row.updatedAt ?? null
        const updatedAt = updatedAtRaw ? new Date(String(updatedAtRaw)).toISOString() : null
        return {
          id: row.id,
          title: row.title ?? null,
          subtitle: row.subtitle ?? null,
          sku: row.sku ?? null,
          handle: row.handle ?? null,
          productType: row.product_type ?? row.productType ?? null,
          statusEntryId: row.status_entry_id ?? row.statusEntryId ?? null,
          primaryCurrencyCode: row.primary_currency_code ?? row.primaryCurrencyCode ?? null,
          defaultMediaId: row.default_media_id ?? row.defaultMediaId ?? null,
          defaultMediaUrl: row.default_media_url ?? row.defaultMediaUrl ?? null,
          imageUrl: row.default_media_url ?? row.defaultMediaUrl ?? null,
          isActive: !!(row.is_active ?? row.isActive),
          isConfigurable: !!(row.is_configurable ?? row.isConfigurable),
          organizationId: row.organization_id ?? row.organizationId ?? null,
          tenantId: row.tenant_id ?? row.tenantId ?? null,
          createdAt,
          updatedAt,
        }
      }),
      total: typeof data.total === 'number' ? data.total : 0,
      limit,
      offset,
    }
  },
}) as unknown as CatalogAiToolDefinition

const getProductInput = z.object({
  productId: z.string().uuid().describe('Catalog product id (UUID).'),
  includeRelated: z
    .boolean()
    .optional()
    .describe(
      'When true, include categories, tags, variants, prices (base + offers), media (metadata only), unit conversions, and custom fields (each related list capped at 100).',
    ),
})

const getProductTool: CatalogAiToolDefinition = {
  name: 'catalog.get_product',
  displayName: 'Get product',
  description:
    'Fetch a catalog product by id with core fields and (optionally) categories, tags, variants, prices, media metadata, unit conversions, and custom fields. Returns { found: false } when the record is outside tenant/org scope or missing.',
  inputSchema: getProductInput,
  requiredFeatures: ['catalog.products.view'],
  tags: ['read', 'catalog'],
  handler: async (rawInput, ctx) => {
    const { tenantId } = assertTenantScope(ctx)
    const input = getProductInput.parse(rawInput)
    const em = resolveEm(ctx)
    const where: Record<string, unknown> = {
      id: input.productId,
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
      return { found: false as const, productId: input.productId }
    }

    let related: Record<string, unknown> | null = null
    let customFields: Record<string, unknown> = {}
    if (input.includeRelated) {
      const scope = buildScope(ctx, tenantId)
      const [
        categoryAssignments,
        tagAssignments,
        variants,
        prices,
        mediaAttachments,
        unitConversions,
        customFieldValues,
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
      ])
      customFields = customFieldValues[product.id] ?? {}
      related = {
        categories: categoryAssignments
          .map((assignment) => {
            const category = (assignment as any).category
            if (!category || typeof category === 'string') {
              const fallbackId = typeof category === 'string' ? category : null
              return fallbackId ? { id: fallbackId, name: null, slug: null } : null
            }
            return {
              id: category.id,
              name: category.name ?? null,
              slug: category.slug ?? null,
            }
          })
          .filter((value): value is { id: string; name: string | null; slug: string | null } => value !== null),
        tags: tagAssignments
          .map((assignment) => {
            const tag = (assignment as any).tag as CatalogProductTag | string | null
            if (!tag || typeof tag === 'string') return null
            return { id: tag.id, label: tag.label, slug: tag.slug }
          })
          .filter((value): value is { id: string; label: string; slug: string } => value !== null),
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
        prices: prices.map((price) => ({
          id: price.id,
          priceKindId: (price as any).priceKind && typeof (price as any).priceKind === 'object'
            ? (price as any).priceKind.id
            : (price as any).priceKind ?? null,
          currencyCode: price.currencyCode,
          kind: price.kind,
          minQuantity: price.minQuantity,
          maxQuantity: price.maxQuantity ?? null,
          unitPriceNet: price.unitPriceNet ?? null,
          unitPriceGross: price.unitPriceGross ?? null,
          channelId: price.channelId ?? null,
          offerId: (price as any).offer && typeof (price as any).offer === 'object'
            ? (price as any).offer.id
            : (price as any).offer ?? null,
          variantId: (price as any).variant && typeof (price as any).variant === 'object'
            ? (price as any).variant.id
            : (price as any).variant ?? null,
          startsAt: price.startsAt ? new Date(price.startsAt).toISOString() : null,
          endsAt: price.endsAt ? new Date(price.endsAt).toISOString() : null,
        })),
        media: mediaAttachments.map((attachment) => ({
          id: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: attachment.fileSize,
          url: attachment.url,
        })),
        unitConversions: unitConversions.map((row) => ({
          id: row.id,
          unitCode: row.unitCode,
          toBaseFactor: row.toBaseFactor,
          sortOrder: row.sortOrder,
          isActive: !!row.isActive,
        })),
        customFields,
      }
    }

    return {
      found: true as const,
      product: {
        id: product.id,
        title: product.title,
        subtitle: product.subtitle ?? null,
        description: product.description ?? null,
        sku: product.sku ?? null,
        handle: product.handle ?? null,
        productType: product.productType,
        statusEntryId: product.statusEntryId ?? null,
        primaryCurrencyCode: product.primaryCurrencyCode ?? null,
        taxRate: product.taxRate ?? null,
        taxRateId: product.taxRateId ?? null,
        defaultUnit: product.defaultUnit ?? null,
        defaultSalesUnit: product.defaultSalesUnit ?? null,
        defaultSalesUnitQuantity: product.defaultSalesUnitQuantity ?? null,
        unitPriceEnabled: !!product.unitPriceEnabled,
        unitPriceReferenceUnit: product.unitPriceReferenceUnit ?? null,
        unitPriceBaseQuantity: product.unitPriceBaseQuantity ?? null,
        defaultMediaId: product.defaultMediaId ?? null,
        defaultMediaUrl: product.defaultMediaUrl ?? null,
        imageUrl: product.defaultMediaUrl ?? null,
        weightValue: product.weightValue ?? null,
        weightUnit: product.weightUnit ?? null,
        dimensions: product.dimensions ?? null,
        metadata: product.metadata ?? null,
        customFieldsetCode: product.customFieldsetCode ?? null,
        isConfigurable: !!product.isConfigurable,
        isActive: !!product.isActive,
        organizationId: product.organizationId ?? null,
        tenantId: product.tenantId ?? null,
        createdAt: product.createdAt ? new Date(product.createdAt).toISOString() : null,
        updatedAt: product.updatedAt ? new Date(product.updatedAt).toISOString() : null,
      },
      customFields,
      related,
    }
  },
}

export const productsAiTools: CatalogAiToolDefinition[] = [listProductsTool, getProductTool]

export default productsAiTools
