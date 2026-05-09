import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { E } from '#generated/entities.ids.generated'
import { Warehouse } from '../../data/entities'
import { warehouseCreateSchema, warehouseUpdateSchema } from '../../data/validators'
import { createPagedListResponseSchema, createWmsCrudOpenApi, defaultOkResponseSchema } from '../openapi'

const F = {
  id: 'id',
  organization_id: 'organization_id',
  tenant_id: 'tenant_id',
  name: 'name',
  code: 'code',
  is_active: 'is_active',
  address_line1: 'address_line1',
  city: 'city',
  postal_code: 'postal_code',
  country: 'country',
  timezone: 'timezone',
  created_at: 'created_at',
  updated_at: 'updated_at',
} as const

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
  POST: { requireAuth: true, requireFeatures: ['wms.manage_warehouses'] },
  PUT: { requireAuth: true, requireFeatures: ['wms.manage_warehouses'] },
  DELETE: { requireAuth: true, requireFeatures: ['wms.manage_warehouses'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  pageSize: z.coerce.number().min(1).max(100).default(25),
  search: z.string().optional(),
  ids: z.string().optional(),
  isActive: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: Warehouse,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.wms.warehouse },
  list: {
    schema: listSchema,
    disableListCache: true,
    entityId: E.wms.warehouse,
    fields: [
      F.id,
      F.organization_id,
      F.tenant_id,
      F.name,
      F.code,
      F.is_active,
      F.address_line1,
      F.city,
      F.postal_code,
      F.country,
      F.timezone,
      F.created_at,
      F.updated_at,
    ],
    sortFieldMap: {
      name: F.name,
      code: F.code,
      createdAt: F.created_at,
      updatedAt: F.updated_at,
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        filters[F.id] = {
          $in: query.ids.split(',').map((value) => value.trim()).filter((value) => value.length > 0),
        }
      }
      const isActive = parseBooleanToken(query.isActive)
      if (isActive !== null) filters[F.is_active] = { $eq: isActive }
      const term = query.search?.trim()
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.$or = [
          { [F.name]: { $ilike: like } },
          { [F.code]: { $ilike: like } },
          { [F.city]: { $ilike: like } },
          { [F.country]: { $ilike: like } },
        ]
      }
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'wms.warehouses.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(warehouseCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.warehouseId ?? null }),
      status: 201,
    },
    update: {
      commandId: 'wms.warehouses.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(warehouseUpdateSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'wms.warehouses.delete',
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

const warehouseListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  organization_id: z.string().uuid().nullable().optional(),
  tenant_id: z.string().uuid().nullable().optional(),
  name: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
  is_active: z.boolean().nullable().optional(),
  address_line1: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  postal_code: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
})

export const openApi = createWmsCrudOpenApi({
  resourceName: 'Warehouse',
  pluralName: 'Warehouses',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(warehouseListItemSchema),
  create: {
    schema: warehouseCreateSchema,
    description: 'Creates a warehouse for inventory operations.',
  },
  update: {
    schema: warehouseUpdateSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a warehouse by id.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a warehouse by id.',
  },
})
