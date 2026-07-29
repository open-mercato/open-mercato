import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '#generated/entities.ids.generated'
import { WarehouseZone } from '../../data/entities'
import { warehouseZoneCreateSchema, warehouseZoneUpdateSchema } from '../../data/validators'
import { createPagedListResponseSchema, createWmsCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { attachWarehouseLabelsToListItems } from '../listEnrichers'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
  POST: { requireAuth: true, requireFeatures: ['wms.manage_zones'] },
  PUT: { requireAuth: true, requireFeatures: ['wms.manage_zones'] },
  DELETE: { requireAuth: true, requireFeatures: ['wms.manage_zones'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  search: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: WarehouseZone,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.wms.warehouse_zone },
  list: {
    schema: listSchema,
    entityId: E.wms.warehouse_zone,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'warehouse_id',
      'code',
      'name',
      'priority',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      name: 'name',
      code: 'code',
      priority: 'priority',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.warehouseId) filters.warehouse_id = { $eq: query.warehouseId }
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        filters.id = {
          $in: query.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0),
        }
      }
      const term = query.search?.trim()
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.$or = [
          { code: { $ilike: like } },
          { name: { $ilike: like } },
        ]
      }
      return filters
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      await attachWarehouseLabelsToListItems(payload, ctx)
    },
  },
  actions: {
    create: {
      commandId: 'wms.zones.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(warehouseZoneCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.zoneId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'wms.zones.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(warehouseZoneUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'wms.zones.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return { id: resolveCrudRecordId(parsed, ctx, translate) }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const zoneListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  warehouse_name: z.string().nullable().optional(),
  warehouse_code: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  priority: z.number().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createWmsCrudOpenApi({
  resourceName: 'Warehouse zone',
  pluralName: 'Warehouse zones',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(zoneListItemSchema),
  create: {
    schema: warehouseZoneCreateSchema,
    description: 'Creates a zone within a warehouse.',
  },
  update: {
    schema: warehouseZoneUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a warehouse zone by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a warehouse zone by id.',
  },
})
