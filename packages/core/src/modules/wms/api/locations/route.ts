import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { E } from '#generated/entities.ids.generated'
import { WarehouseLocation } from '../../data/entities'
import { warehouseLocationCreateSchema, warehouseLocationUpdateSchema } from '../../data/validators'
import { createPagedListResponseSchema, createWmsCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { attachWarehouseLabelsToListItems } from '../listEnrichers'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
  POST: { requireAuth: true, requireFeatures: ['wms.manage_locations'] },
  PUT: { requireAuth: true, requireFeatures: ['wms.manage_locations'] },
  DELETE: { requireAuth: true, requireFeatures: ['wms.manage_locations'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  search: z.string().optional(),
  warehouseId: z.string().uuid().optional(),
  parentId: z.string().uuid().optional(),
  type: z.enum(['zone', 'aisle', 'rack', 'bin', 'slot', 'dock', 'staging']).optional(),
  isActive: z.string().optional(),
  ids: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: WarehouseLocation,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.wms.warehouse_location },
  list: {
    schema: listSchema,
    entityId: E.wms.warehouse_location,
    fields: [
      'id',
      'organization_id',
      'tenant_id',
      'warehouse_id',
      'parent_id',
      'code',
      'type',
      'is_active',
      'capacity_units',
      'capacity_weight',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      code: 'code',
      type: 'type',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.warehouseId) filters.warehouse_id = { $eq: query.warehouseId }
      if (query.parentId) filters.parent_id = { $eq: query.parentId }
      if (query.type) filters.type = { $eq: query.type }
      const isActive = parseBooleanToken(query.isActive)
      if (isActive !== null) filters.is_active = { $eq: isActive }
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
          { type: { $ilike: like } },
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
      commandId: 'wms.locations.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(warehouseLocationCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.locationId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'wms.locations.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(warehouseLocationUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'wms.locations.delete',
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

const locationListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  warehouse_id: z.string().uuid().nullable().optional(),
  warehouse_name: z.string().nullable().optional(),
  warehouse_code: z.string().nullable().optional(),
  parent_id: z.string().uuid().nullable().optional(),
  code: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  capacity_units: z.union([z.string(), z.number()]).nullable().optional(),
  capacity_weight: z.union([z.string(), z.number()]).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createWmsCrudOpenApi({
  resourceName: 'Warehouse location',
  pluralName: 'Warehouse locations',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(locationListItemSchema),
  create: {
    schema: warehouseLocationCreateSchema,
    description: 'Creates a storage location within a warehouse hierarchy.',
  },
  update: {
    schema: warehouseLocationUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a warehouse location by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a warehouse location by id.',
  },
})
