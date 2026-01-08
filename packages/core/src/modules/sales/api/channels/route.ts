import { z } from 'zod'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesChannel } from '../../data/entities'
import { channelCreateSchema, channelUpdateSchema } from '../../data/validators'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import * as F from '@open-mercato/core/generated/entities/sales_channel'
import {
  createPagedListResponseSchema,
  createSalesCrudOpenApi,
  defaultDeleteRequestSchema,
} from '../openapi'
import { CatalogOffer } from '@open-mercato/core/modules/catalog/data/entities'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

const rawBodySchema = z.object({}).passthrough()

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    isActive: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    withDeleted: z.coerce.boolean().optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
  POST: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['sales.channels.manage'] },
}

export const metadata = routeMetadata

const salesChannelItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  description: z.string().nullable(),
  statusEntryId: z.string().uuid().nullable(),
  isActive: z.boolean(),
  organizationId: z.string().uuid().nullable(),
  tenantId: z.string().uuid().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  offerCount: z.number().optional(),
})

const salesChannelListResponseSchema = createPagedListResponseSchema(salesChannelItemSchema)

export function parseIdList(raw?: string): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => UUID_REGEX.test(value))
}

export function buildSearchFilters(query: z.infer<typeof listSchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.id) filters.id = { $eq: query.id }
  else {
    const ids = parseIdList(query.ids)
    if (ids.length) filters.id = { $in: ids }
  }
  if (query.search && query.search.trim().length > 0) {
    const term = `%${escapeLikePattern(query.search.trim())}%`
    filters.$or = [
      { name: { $ilike: term } },
      { code: { $ilike: term } },
      { description: { $ilike: term } },
    ]
  }
  if (query.isActive === 'true') filters.is_active = true
  if (query.isActive === 'false') filters.is_active = false
  return filters
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesChannel,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_channel,
    fields: [
      F.id,
      F.name,
      F.code,
      F.description,
      F.status_entry_id,
      F.is_active,
      F.website_url,
      F.contact_email,
      F.contact_phone,
      F.address_line1,
      F.address_line2,
      F.city,
      F.region,
      F.postal_code,
      F.country,
      F.latitude,
      F.longitude,
      F.organization_id,
      F.tenant_id,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      id: F.id,
      name: F.name,
      code: F.code,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => buildSearchFilters(query),
    decorateCustomFields: { entityIds: [E.sales.sales_channel] },
    transformItem: (item: any) => {
      const offerCount =
        typeof item.offerCount === 'number'
          ? item.offerCount
          : typeof item.offer_count === 'number'
            ? item.offer_count
            : 0
      const base = {
        id: item.id,
        name: item.name,
        code: item.code ?? null,
        description: item.description ?? null,
        statusEntryId: item.status_entry_id ?? null,
        isActive: item.is_active ?? false,
        websiteUrl: item.website_url ?? null,
        contactEmail: item.contact_email ?? null,
        contactPhone: item.contact_phone ?? null,
        addressLine1: item.address_line1 ?? null,
        addressLine2: item.address_line2 ?? null,
        city: item.city ?? null,
        region: item.region ?? null,
        postalCode: item.postal_code ?? null,
        country: item.country ?? null,
        latitude: item.latitude ?? null,
        longitude: item.longitude ?? null,
        organizationId: item.organization_id ?? null,
        tenantId: item.tenant_id ?? null,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        offerCount,
      }
      const { custom } = splitCustomFieldPayload(item)
      return Object.keys(custom).length ? { ...base, customFields: custom } : base
    },
  },
  actions: {
    create: {
      commandId: 'sales.channels.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(channelCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.channelId ?? result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'sales.channels.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(channelUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'sales.channels.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        return { id }
      },
      response: () => ({ ok: true }),
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      await decorateChannelsWithOfferCounts(payload, ctx)
    },
  },
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Sales channel',
  pluralName: 'Sales channels',
  description: 'Manage sales channels to segment orders and pricing across marketplaces or stores.',
  querySchema: listSchema,
  listResponseSchema: salesChannelListResponseSchema,
  create: { schema: channelCreateSchema },
  update: { schema: channelUpdateSchema },
  del: { schema: defaultDeleteRequestSchema },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export async function decorateChannelsWithOfferCounts(
  payload: { items?: Array<Record<string, unknown>> },
  ctx: CrudCtx,
) {
  const items = Array.isArray(payload.items) ? payload.items : []
  if (!items.length) return
  const channelIds = items
    .map((item) => {
      const value = item?.id
      return typeof value === 'string' && value.length ? value : null
    })
    .filter((value): value is string => !!value)
  if (!channelIds.length) return
  try {
    const em = ctx.container.resolve('em') as EntityManager
    const offers = await em.find(
      CatalogOffer,
      { channelId: { $in: channelIds }, deletedAt: null },
      { fields: ['id', 'channelId'] },
    )
    const countMap = new Map<string, number>()
    offers.forEach((offer) => {
      const channelId = offer.channelId
      if (!channelId) return
      countMap.set(channelId, (countMap.get(channelId) ?? 0) + 1)
    })
    items.forEach((item) => {
      const id = typeof item.id === 'string' ? item.id : null
      if (!id) return
      ;(item as Record<string, unknown>).offerCount = countMap.get(id) ?? 0
    })
  } catch (err) {
    console.warn('[sales.channels] failed to resolve channel offer counts', err)
  }
}
