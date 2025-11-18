import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CatalogOffer, CatalogProduct, CatalogProductPrice } from '../../data/entities'
import { offerCreateSchema, offerUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/catalog_offer'
import { parseIdList } from '../products/route'

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

const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
  POST: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
}

export const routeMetadata = metadata
export { metadata }

function normalizeSearch(term?: string | null): string | null {
  if (!term) return null
  const trimmed = term.trim()
  if (!trimmed.length) return null
  return trimmed
}

function buildOfferFilters(query: OfferListQuery): Record<string, unknown> {
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

async function decorateOffersWithDetails(
  items: any[],
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
  const [products, prices] = await Promise.all([
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
  items.forEach((item) => {
    const productId = String(item?.productId ?? '')
    item.product = productId ? productMap.get(productId) ?? null : null
    item.prices = priceMap.get(String(item?.id ?? '')) ?? []
  })
}

const crud = makeCrudRoute({
  metadata,
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
    transformItem: (item: any) => {
      if (!item) return item
      return {
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
