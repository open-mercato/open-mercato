import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
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

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
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
})

const salesChannelListResponseSchema = createPagedListResponseSchema(salesChannelItemSchema)

function buildSearchFilters(query: z.infer<typeof listSchema>): Record<string, unknown> {
  const filters: Record<string, unknown> = {}
  if (query.search && query.search.trim().length > 0) {
    const term = `%${query.search.trim().replace(/%/g, '\\%')}%`
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
      const base = {
        id: item.id,
        name: item.name,
        code: item.code ?? null,
        description: item.description ?? null,
        statusEntryId: item.status_entry_id ?? null,
        isActive: item.is_active ?? false,
        organizationId: item.organization_id ?? null,
        tenantId: item.tenant_id ?? null,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      }
      const custom: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(item ?? {})) {
        if (key.startsWith('cf:')) custom[key.slice(3)] = value
      }
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
