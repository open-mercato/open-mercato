import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { buildCustomFieldFiltersFromQuery, extractAllCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import {
  CatalogOffer,
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductVariant,
  CatalogAttributeSchemaTemplate,
} from '../../data/entities'
import { CATALOG_PRODUCT_TYPES } from '../../data/types'
import type { CatalogAttributeSchema, CatalogProductType } from '../../data/types'
import { productCreateSchema, productUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/catalog_product'
import { parseBooleanFlag, sanitizeSearchTerm } from '../helpers'
import type { CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import {
  resolvePriceChannelId,
  resolvePriceOfferId,
  resolvePriceVariantId,
  type PricingContext,
  type PriceRow,
} from '../../lib/pricing'
import type { CatalogPricingService } from '../../services/catalogPricingService'
import { normalizeAttributeSchema, resolveAttributeSchema } from '../../lib/attributeSchemas'
const rawBodySchema = z.object({}).passthrough()

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    status: z.string().optional(),
    isActive: z.string().optional(),
    configurable: z.string().optional(),
    productType: z.enum(CATALOG_PRODUCT_TYPES).optional(),
    channelIds: z.string().optional(),
    channelId: z.string().uuid().optional(),
    offerId: z.string().uuid().optional(),
    userId: z.string().uuid().optional(),
    userGroupId: z.string().uuid().optional(),
    customerId: z.string().uuid().optional(),
    customerGroupId: z.string().uuid().optional(),
    quantity: z.coerce.number().min(1).max(100000).optional(),
    priceDate: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    withDeleted: z.coerce.boolean().optional(),
  })
  .passthrough()

type ProductsQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
  POST: { requireAuth: true, requireFeatures: ['catalog.products.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['catalog.products.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['catalog.products.manage'] },
}

export const metadata = routeMetadata

export function parseIdList(raw?: string): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => UUID_REGEX.test(value))
}

export async function buildProductFilters(
  query: ProductsQuery,
  ctx: CrudCtx
): Promise<Record<string, unknown>> {
  const filters: Record<string, unknown> = {}
  const term = sanitizeSearchTerm(query.search)
  if (term) {
    const like = `%${term}%`
    filters.$or = [
      { title: { $ilike: like } },
      { subtitle: { $ilike: like } },
      { sku: { $ilike: like } },
      { handle: { $ilike: like } },
      { description: { $ilike: like } },
    ]
  }
  if (query.status && query.status.trim()) {
    filters.status_entry_id = { $eq: query.status.trim() }
  }
  const active = parseBooleanFlag(query.isActive)
  if (active !== undefined) {
    filters.is_active = active
  }
  const configurable = parseBooleanFlag(query.configurable)
  if (configurable !== undefined) {
    filters.is_configurable = configurable
  }
  if (query.productType) {
    filters.product_type = { $eq: query.productType }
  }
  const channelFilterIds = parseIdList(query.channelIds)
  if (channelFilterIds.length) {
    const em = (ctx.container.resolve('em') as EntityManager).fork()
    const offerRows = await em.find(
      CatalogOffer,
      {
        channelId: { $in: channelFilterIds },
        deletedAt: null,
      },
      { fields: ['id', 'product'] }
    )
    const productIds = Array.from(
      new Set(
        offerRows
          .map((offer) =>
            typeof offer.product === 'string' ? offer.product : offer.product?.id ?? null
          )
          .filter((id): id is string => !!id)
      )
    )
    if (!productIds.length) {
      filters.id = { $eq: '00000000-0000-0000-0000-000000000000' }
    } else {
      filters.id = { $in: productIds }
    }
  }
  const tenantId = ctx.auth?.tenantId ?? null
  try {
    const em = ctx.container.resolve('em') as EntityManager
    const cfFilters = await buildCustomFieldFiltersFromQuery({
      entityIds: [E.catalog.catalog_product],
      query,
      em,
      tenantId,
    })
    Object.assign(filters, cfFilters)
  } catch {
    // ignore custom field filter errors; fall back to base filters
  }
  return filters
}

export function buildPricingContext(query: ProductsQuery, channelFallback: string | null): PricingContext {
  const quantity = Number.isFinite(Number(query.quantity)) ? Number(query.quantity) : 1
  const parsedDate = query.priceDate ? new Date(query.priceDate) : new Date()
  const channelId = query.channelId ?? channelFallback ?? null
  return {
    channelId,
    offerId: query.offerId ?? null,
    userId: query.userId ?? null,
    userGroupId: query.userGroupId ?? null,
    customerId: query.customerId ?? null,
    customerGroupId: query.customerGroupId ?? null,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    date: Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
  }
}


type ProductListItem = Record<string, unknown> & {
  id?: string
  title?: string | null
  subtitle?: string | null
  description?: string | null
  sku?: string | null
  handle?: string | null
  product_type?: CatalogProductType | null
  attribute_schema?: CatalogAttributeSchema | null
  attribute_schema_override?: CatalogAttributeSchema | null
  attribute_schema_source?: {
    id: string
    name: string | null
    code: string | null
    description: string | null
  } | null
  attribute_schema_id?: string | null
  option_schema_id?: string | null
}

async function decorateProductsAfterList(
  payload: { items?: ProductListItem[] },
  ctx: CrudCtx & { query: ProductsQuery }
): Promise<void> {
  const items = Array.isArray(payload?.items) ? payload.items : []
  if (!items.length) return
  const productIds = items
    .map((item) => (typeof item.id === 'string' ? item.id : null))
    .filter((id): id is string => !!id)
  if (!productIds.length) return
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const schemaIds = Array.from(
    new Set(
      items
        .map((item) =>
          typeof item.attribute_schema_id === 'string' ? item.attribute_schema_id : null
        )
        .filter((id): id is string => !!id)
    )
  )

  const schemaMap = new Map<
    string,
    Pick<CatalogAttributeSchemaTemplate, 'id' | 'name' | 'code' | 'description' | 'schema'>
  >()
  if (schemaIds.length) {
    const schemas = await em.find(
      CatalogAttributeSchemaTemplate,
      { id: { $in: schemaIds } },
      { fields: ['id', 'name', 'code', 'description', 'schema'] }
    )
    for (const schema of schemas) {
      const normalizedSchema = normalizeAttributeSchema(schema.schema) ?? schema.schema
      schemaMap.set(schema.id, {
        id: schema.id,
        name: schema.name,
        code: schema.code,
        description: schema.description ?? null,
        schema: normalizedSchema,
      })
    }
  }

  const offers = await em.find(
    CatalogOffer,
    { product: { $in: productIds }, deletedAt: null },
    { orderBy: { createdAt: 'asc' } }
  )
  const offersByProduct = new Map<string, Array<Record<string, unknown>>>()
  for (const offer of offers) {
    const productId =
      typeof offer.product === 'string' ? offer.product : offer.product?.id ?? null
    if (!productId) continue
    const entry = offersByProduct.get(productId) ?? []
    entry.push({
      id: offer.id,
      channelId: offer.channelId,
      title: offer.title,
      description: offer.description ?? null,
      isActive: offer.isActive,
      localizedContent: offer.localizedContent ?? null,
    })
    offersByProduct.set(productId, entry)
  }

  for (const item of items) {
    const override =
      item.attribute_schema && typeof item.attribute_schema === 'object'
        ? (item.attribute_schema as CatalogAttributeSchema)
        : null
    const schemaId =
      typeof item.attribute_schema_id === 'string' ? item.attribute_schema_id : null
    const baseSchema = schemaId ? schemaMap.get(schemaId) : null
    const resolved = resolveAttributeSchema(baseSchema?.schema ?? null, override)
    item.attribute_schema_override = override
    item.attribute_schema = resolved
    item.attribute_schema_source = baseSchema
      ? {
          id: baseSchema.id,
          name: baseSchema.name,
          code: baseSchema.code,
          description: baseSchema.description ?? null,
        }
      : null
  }

  const variants = await em.find(
    CatalogProductVariant,
    { product: { $in: productIds }, deletedAt: null },
    { fields: ['id', 'product'] }
  )
  const variantToProduct = new Map<string, string>()
  for (const variant of variants) {
    const productId =
      typeof variant.product === 'string' ? variant.product : variant.product?.id ?? null
    if (!productId) continue
    variantToProduct.set(variant.id, productId)
  }
  const variantIds = Array.from(variantToProduct.keys())
  const priceWhere =
    variantIds.length > 0
      ? {
          $or: [{ product: { $in: productIds } }, { variant: { $in: variantIds } }],
        }
      : { product: { $in: productIds } }
  const priceRows = await em.find(
    CatalogProductPrice,
    priceWhere,
    { populate: ['offer', 'variant', 'product'] }
  )
  const pricesByProduct = new Map<string, PriceRow[]>()
  for (const price of priceRows) {
    let productId: string | null = null
    if (price.product) {
      productId =
        typeof price.product === 'string' ? price.product : price.product?.id ?? null
    } else if (price.variant) {
      const variantId = typeof price.variant === 'string' ? price.variant : price.variant.id
      productId = variantToProduct.get(variantId) ?? null
    }
    if (!productId) continue
    const entry = pricesByProduct.get(productId) ?? []
    entry.push(price)
    pricesByProduct.set(productId, entry)
  }

  const channelFilterIds = parseIdList(ctx.query.channelIds)
  const channelContext =
    ctx.query.channelId ?? (channelFilterIds.length === 1 ? channelFilterIds[0] : null)
  const pricingContext = buildPricingContext(ctx.query, channelContext)
  const pricingService = ctx.container.resolve<CatalogPricingService>('catalogPricingService')

  for (const item of items) {
    const id = typeof item.id === 'string' ? item.id : null
    if (!id) continue
    item.offers = offersByProduct.get(id) ?? []
    const priceCandidates = pricesByProduct.get(id) ?? []
    const best = await pricingService.resolvePrice(priceCandidates, pricingContext)
    if (best) {
      item.pricing = {
        kind: best.kind,
        currency_code: best.currencyCode,
        unit_price_net: best.unitPriceNet,
        unit_price_gross: best.unitPriceGross,
        min_quantity: best.minQuantity,
        max_quantity: best.maxQuantity ?? null,
        tax_rate: best.taxRate ?? null,
        scope: {
          variant_id: resolvePriceVariantId(best),
          offer_id: resolvePriceOfferId(best),
          channel_id: resolvePriceChannelId(best),
          user_id: best.userId ?? null,
          user_group_id: best.userGroupId ?? null,
          customer_id: best.customerId ?? null,
          customer_group_id: best.customerGroupId ?? null,
        },
      }
    } else {
      item.pricing = null
    }
  }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogProduct,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.catalog.catalog_product,
    fields: [
      F.id,
      F.title,
      F.subtitle,
      F.description,
      F.sku,
      F.handle,
      F.product_type,
      F.status_entry_id,
      F.primary_currency_code,
      F.default_unit,
      F.is_configurable,
      F.is_active,
      F.metadata,
      'attribute_schema_id',
      'option_schema_id',
      F.attribute_schema,
      F.attribute_values,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      title: F.title,
      sku: F.sku,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: buildProductFilters,
    transformItem: (item: ProductListItem | null | undefined) => {
      if (!item) return item
      const normalized = { ...item }
      const cfEntries = extractAllCustomFieldEntries(item)
      for (const key of Object.keys(normalized)) {
        if (key.startsWith('cf:')) {
          delete normalized[key]
        }
      }
      return { ...normalized, ...cfEntries }
    },
  },
  hooks: {
    afterList: decorateProductsAfterList,
  },
  actions: {
    create: {
      commandId: 'catalog.products.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(productCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.productId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'catalog.products.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(productUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'catalog.products.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) throw new CrudHttpError(400, { error: translate('catalog.errors.id_required', 'Product id is required.') })
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE
