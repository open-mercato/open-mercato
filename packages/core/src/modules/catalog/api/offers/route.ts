import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CatalogOffer, CatalogProduct, CatalogProductPrice, CatalogProductVariant } from '../../data/entities'
import { offerCreateSchema, offerUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/catalog_offer'
import { parseIdList } from '../products/route'
import { extractAllCustomFieldEntries } from '@open-mercato/shared/lib/crud/custom-fields'
import {
  createCatalogCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../openapi'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    productId: z.string().uuid().optional(),
    channelId: z.string().uuid().optional(),
    channelIds: z.string().optional(),
    id: z.string().uuid().optional(),
    search: z.string().optional(),
    isActive: z.string().optional(),
    withDeleted: z.coerce.boolean().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type OfferListQuery = z.infer<typeof listSchema>

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
  POST: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
}

export const metadata = routeMetadata

export function normalizeSearch(term?: string | null): string | null {
  if (!term) return null
  const trimmed = term.trim()
  if (!trimmed.length) return null
  return trimmed
}

export function buildOfferFilters(query: OfferListQuery): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  const searchTerm = normalizeSearch(query.search)
  if (query.id) {
    filters.id = { $eq: query.id }
  }
  if (query.productId) {
    filters.product_id = { $eq: query.productId }
  }
  if (query.channelId) {
    filters.channel_id = { $eq: query.channelId }
  } else {
    const channelIds = parseIdList(query.channelIds)
    if (channelIds.length) {
      filters.channel_id = { $in: channelIds }
    }
  }
  if (searchTerm) {
    const like = `%${searchTerm.replace(/%/g, '\\%')}%`
    filters.$or = [{ [F.title]: { $ilike: like } }, { [F.description]: { $ilike: like } }]
  }
  if (query.isActive === 'true') filters[F.is_active] = true
  if (query.isActive === 'false') filters[F.is_active] = false
  return filters
}

export async function decorateOffersWithDetails(
  items: Record<string, unknown>[],
  ctx: CrudCtx,
): Promise<void> {
  if (!items.length) return
  const offerIds = items
    .map((item) => (item?.id ? String(item.id) : null))
    .filter((value): value is string => !!value)
  const productIds = items
    .map((item) => (item?.productId ? String(item.productId) : null))
    .filter((value): value is string => !!value)
  if (!offerIds.length && !productIds.length) return
  const em = ctx.container.resolve('em') as EntityManager
  const [products, prices, defaultVariants] = await Promise.all([
    productIds.length
      ? em.find(
          CatalogProduct,
          { id: { $in: productIds } },
          {
            fields: ['id', 'title', 'description', 'defaultMediaId', 'defaultMediaUrl', 'sku'],
          },
        )
      : [],
    offerIds.length
      ? em.find(
          CatalogProductPrice,
          { offer: { $in: offerIds } },
          { populate: ['priceKind'] },
        )
      : [],
    productIds.length
      ? em.find(
          CatalogProductVariant,
          { product: { $in: productIds }, isDefault: true },
          { fields: ['id', 'product'] },
        )
      : [],
  ])
  const productMap = new Map(
    products.map((product) => [
      product.id,
      {
        id: product.id,
        title: product.title,
        defaultMediaId: product.defaultMediaId ?? null,
        defaultMediaUrl: product.defaultMediaUrl ?? null,
        sku: product.sku ?? null,
      },
    ]),
  )
  const priceMap = new Map<string, Array<Record<string, unknown>>>()
  prices.forEach((price) => {
    const offerRef = price.offer
    const offerId =
      typeof offerRef === 'string'
        ? offerRef
        : offerRef && typeof offerRef === 'object' && 'id' in offerRef
          ? (offerRef as { id?: string }).id ?? null
          : null
    if (!offerId) return
    const priceKind = price.priceKind
    const priceKindId =
      typeof priceKind === 'string'
        ? priceKind
        : priceKind && typeof priceKind === 'object'
          ? (priceKind as { id?: string }).id ?? null
          : null
    const priceKindCode =
      priceKind && typeof priceKind === 'object' && 'code' in priceKind
        ? (priceKind as { code?: string }).code ?? null
        : null
    const priceKindTitle =
      priceKind && typeof priceKind === 'object' && 'title' in priceKind
        ? (priceKind as { title?: string }).title ?? null
        : null
    const displayMode =
      priceKind && typeof priceKind === 'object' && 'displayMode' in priceKind
        ? (priceKind as { displayMode?: string }).displayMode ?? 'excluding-tax'
        : 'excluding-tax'
    const bucket = priceMap.get(offerId) ?? []
    bucket.push({
      id: price.id,
      priceKindId,
      priceKindCode,
      priceKindTitle,
      currencyCode: price.currencyCode ?? null,
      unitPriceNet: price.unitPriceNet ?? null,
      unitPriceGross: price.unitPriceGross ?? null,
      displayMode,
      minQuantity: price.minQuantity ?? null,
      maxQuantity: price.maxQuantity ?? null,
    })
    priceMap.set(offerId, bucket)
  })
  const variantToProductMap = new Map<string, string>()
  defaultVariants.forEach((variant) => {
    const variantId = typeof variant.id === 'string' ? variant.id : null
    const productRef =
      typeof variant.product === 'string'
        ? variant.product
        : variant.product && typeof variant.product === 'object' && 'id' in variant.product
          ? (variant.product as { id?: string }).id ?? null
          : null
    if (variantId && productRef) {
      variantToProductMap.set(variantId, productRef)
    }
  })
  const DEFAULT_CHANNEL_KEY = '__default__'
  type ProductFallbackPrice = { prices: Record<string, unknown>[]; priority: number }
  const productChannelPriceMap = new Map<string, Map<string, ProductFallbackPrice>>()
  const assignFallbackPrice = (productRef: string | null, channelRef: string | null, payload: Record<string, unknown>, priority: number) => {
    if (!productRef) return
    const bucket = productChannelPriceMap.get(productRef) ?? new Map()
    const effectiveChannel = channelRef ?? DEFAULT_CHANNEL_KEY
    const existing = bucket.get(effectiveChannel)
    if (existing && existing.priority > priority) return
    if (existing && existing.priority === priority) {
      bucket.set(effectiveChannel, { prices: [...existing.prices, payload], priority })
      productChannelPriceMap.set(productRef, bucket)
      return
    }
    bucket.set(effectiveChannel, { prices: [payload], priority })
    productChannelPriceMap.set(productRef, bucket)
  }
  const channelIds = Array.from(new Set(
    items
      .map((item) => {
        if (typeof item?.channelId === 'string') return item.channelId
        if (typeof item?.channel_id === 'string') return item.channel_id
        return null
      })
      .filter((value): value is string => !!value),
  ))
  const channelFilterValues = channelIds.length ? [...channelIds, null] : [null]
  const fallbackTargets: Array<Record<string, unknown>> = []
  if (productIds.length) fallbackTargets.push({ product: { $in: productIds } })
  const defaultVariantIds = Array.from(variantToProductMap.keys())
  if (defaultVariantIds.length) fallbackTargets.push({ variant: { $in: defaultVariantIds } })
  const fallbackEntries = fallbackTargets.length
    ? await em.find(
        CatalogProductPrice,
        {
          offer: null,
          $and: [
            { $or: fallbackTargets },
            channelFilterValues.includes(null)
              ? {
                  $or: [
                    { channelId: { $in: channelFilterValues.filter((id): id is string => typeof id === 'string') } },
                    { channelId: null },
                  ],
                }
              : { channelId: { $in: channelFilterValues } },
          ],
        },
        { populate: ['priceKind'] },
      )
    : []
  fallbackEntries.forEach((entry) => {
    const entryChannelId = typeof entry.channelId === 'string' && entry.channelId.length
      ? entry.channelId
      : null
    const priceKind = entry.priceKind ?? null
    const priceKindId =
      typeof priceKind?.id === 'string'
        ? priceKind.id
        : null
    const priceKindCode =
      typeof priceKind?.code === 'string'
        ? priceKind.code
        : null
    const priceKindTitle =
      typeof priceKind?.title === 'string'
        ? priceKind.title
        : null
    const displayMode = typeof priceKind?.displayMode === 'string'
      ? priceKind.displayMode
      : typeof (priceKind as any)?.display_mode === 'string'
        ? (priceKind as any).display_mode
        : 'excluding-tax'
    const payload = {
      priceKindId,
      priceKindCode,
      priceKindTitle,
      currencyCode: entry.currencyCode ?? null,
      unitPriceNet: entry.unitPriceNet ?? null,
      unitPriceGross: entry.unitPriceGross ?? null,
      displayMode,
    }
    const variantRef =
      typeof entry.variant === 'string'
        ? entry.variant
        : entry.variant && typeof entry.variant === 'object' && 'id' in entry.variant
          ? (entry.variant as { id?: string }).id ?? null
          : null
    if (variantRef) {
      const variantProduct = variantToProductMap.get(variantRef)
      const productRef =
        variantProduct
        ?? (typeof entry.product === 'string'
          ? entry.product
          : entry.product && typeof entry.product === 'object' && 'id' in entry.product
            ? (entry.product as { id?: string }).id ?? null
            : null)
      const priority = entryChannelId ? 4 : 3
      assignFallbackPrice(productRef, entryChannelId, payload, priority)
      return
    }
    const productRef =
      typeof entry.product === 'string'
        ? entry.product
        : entry.product && typeof entry.product === 'object' && 'id' in entry.product
          ? (entry.product as { id?: string }).id ?? null
          : null
    const priority = entryChannelId ? 2 : 1
    assignFallbackPrice(productRef, entryChannelId, payload, priority)
  })
  items.forEach((item) => {
    const productId = String(item?.productId ?? '')
    item.product = productId ? productMap.get(productId) ?? null : null
    item.prices = priceMap.get(String(item?.id ?? '')) ?? []
    const rowChannelId = typeof item?.channelId === 'string'
      ? item.channelId
      : typeof item?.channel_id === 'string'
        ? item.channel_id
        : null
    const bucket = productChannelPriceMap.get(productId)
    const channelKey = rowChannelId ?? DEFAULT_CHANNEL_KEY
    const channelPrice = bucket?.get(channelKey) ?? null
    const defaultPrice = bucket?.get(DEFAULT_CHANNEL_KEY) ?? null
    const effectivePrice = channelPrice ?? defaultPrice ?? null
    item.productChannelPrice = effectivePrice?.prices?.[0] ?? null
    item.productDefaultPrices = effectivePrice?.prices ?? []
  })
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: CatalogOffer,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.catalog.catalog_offer,
    fields: [
      F.id,
      'product_id',
      F.organization_id,
      F.tenant_id,
      F.channel_id,
      F.title,
      F.description,
      'default_media_id',
      'default_media_url',
      F.localized_content,
      F.metadata,
      F.is_active,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      title: F.title,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => buildOfferFilters(query),
    transformItem: (item: Record<string, unknown>) => {
      if (!item) return item
      const cfEntries = extractAllCustomFieldEntries(item)
      const base = {
        id: item.id,
        productId: item.product_id ?? null,
        organizationId: item.organization_id ?? null,
        tenantId: item.tenant_id ?? null,
        channelId: item.channel_id ?? null,
        title: item.title ?? '',
        description: item.description ?? null,
        defaultMediaId: item.default_media_id ?? null,
        defaultMediaUrl: item.default_media_url ?? null,
        localizedContent: item.localized_content ?? null,
        metadata: item.metadata ?? null,
        isActive: item.is_active ?? false,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
      return Object.keys(cfEntries).length ? { ...base, ...cfEntries } : base
    },
  },
  actions: {
    create: {
      commandId: 'catalog.offers.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(offerCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.offerId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'catalog.offers.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(offerUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'catalog.offers.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) {
          throw new CrudHttpError(400, { error: translate('catalog.errors.id_required', 'Offer id is required.') })
        }
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      const items = Array.isArray(payload.items) ? payload.items : []
      if (!items.length) return
      await decorateOffersWithDetails(items, ctx)
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const offerPriceAmount = z.union([z.number(), z.string()])

const offerPriceSchema = z
  .object({
    id: z.string().uuid(),
    priceKindId: z.string().uuid().nullable().optional(),
    priceKindCode: z.string().nullable().optional(),
    priceKindTitle: z.string().nullable().optional(),
    currencyCode: z.string().nullable().optional(),
    unitPriceNet: offerPriceAmount.nullable().optional(),
    unitPriceGross: offerPriceAmount.nullable().optional(),
    displayMode: z.string().nullable().optional(),
    minQuantity: z.number().nullable().optional(),
    maxQuantity: z.number().nullable().optional(),
  })
  .passthrough()

const offerListItemSchema = z
  .object({
    id: z.string().uuid(),
    productId: z.string().uuid().nullable().optional(),
    organizationId: z.string().uuid().nullable().optional(),
    tenantId: z.string().uuid().nullable().optional(),
    channelId: z.string().uuid().nullable().optional(),
    title: z.string(),
    description: z.string().nullable().optional(),
    defaultMediaId: z.string().nullable().optional(),
    defaultMediaUrl: z.string().nullable().optional(),
    localizedContent: z.record(z.string(), z.unknown()).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    isActive: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
    product: z
      .object({
        id: z.string().uuid(),
        title: z.string().nullable().optional(),
        defaultMediaId: z.string().nullable().optional(),
        defaultMediaUrl: z.string().nullable().optional(),
        sku: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    prices: z.array(offerPriceSchema).optional(),
    productChannelPrice: offerPriceSchema.nullable().optional(),
    productDefaultPrices: z.array(offerPriceSchema).optional(),
  })
  .passthrough()

export const openApi = createCatalogCrudOpenApi({
  resourceName: 'Offer',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(offerListItemSchema),
  create: {
    schema: offerCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable() }),
    description: 'Creates a channel offer for a catalog product.',
  },
  update: {
    schema: offerUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates offer content, channel binding, or metadata.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Deletes an offer by id.',
  },
})
