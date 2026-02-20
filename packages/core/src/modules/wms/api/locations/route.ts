import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { parseScopedCommandInput, resolveCrudRecordId } from '../../lib/utils'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { WarehouseLocation } from '../../data/entities'
import { locationCreateSchema, locationUpdateSchema } from '../../data/validators'
import { locationCrudEvents, locationIndexer } from '../../commands/locations'
import { E } from '#generated/entities.ids.generated'
import {
  createWmsCrudOpenApi,
  createPagedListResponseSchema,
  defaultOkResponseSchema,
} from '../../lib/openapi'

const WMS_LOCATION_ENTITY_ID = (E as { wms?: { warehouse_location: string } }).wms?.warehouse_location ?? 'wms:warehouse_location'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['wms.view'] },
  POST: { requireAuth: true, requireFeatures: ['wms.manage_warehouses'] },
  PUT: { requireAuth: true, requireFeatures: ['wms.manage_warehouses'] },
}

export const metadata = routeMetadata

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    ids: z.string().optional(),
    warehouseId: z.string().uuid().optional(),
    type: z.string().optional(),
    isActive: z.string().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined
  const lower = value.trim().toLowerCase()
  if (lower === 'true' || lower === '1') return true
  if (lower === 'false' || lower === '0') return false
  return undefined
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: WarehouseLocation,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: locationCrudEvents as any,
  indexer: locationIndexer as any,
  list: {
    schema: listSchema,
    entityId: WMS_LOCATION_ENTITY_ID as any,
    fields: [
      'id',
      'tenantId',
      'organizationId',
      'warehouseId',
      'code',
      'type',
      'parentId',
      'isActive',
      'capacityUnits',
      'capacityWeight',
      'constraints',
      'createdAt',
      'updatedAt',
    ],
    sortFieldMap: {
      code: 'code',
      type: 'type',
      createdAt: 'createdAt',
      updatedAt: 'updatedAt',
    },
    buildFilters: (query) => {
      const filters: Record<string, unknown> = {}
      if (typeof query.ids === 'string' && query.ids.trim().length > 0) {
        const ids = query.ids.split(',').map((s) => s.trim()).filter(Boolean)
        if (ids.length) filters.id = { $in: ids }
      }
      if (query.warehouseId) filters.warehouseId = query.warehouseId
      if (typeof query.type === 'string' && query.type.trim()) filters.type = query.type.trim()
      const term = typeof query.search === 'string' ? query.search.trim() : ''
      if (term) {
        const like = `%${escapeLikePattern(term)}%`
        filters.code = { $ilike: like }
      }
      const isActive = parseBooleanFlag(query.isActive)
      if (isActive !== undefined) filters.isActive = isActive
      return filters
    },
  },
  actions: {
    create: {
      commandId: 'wms.locations.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const schemaWithScope = locationCreateSchema.merge(
          z.object({ tenantId: z.string().uuid(), organizationId: z.string().uuid().optional() })
        )
        const parsed = (await parseScopedCommandInput(schemaWithScope, raw ?? {}, ctx, translate)) as Record<string, unknown>
        const { tenantId, organizationId, ...rest } = parsed
        return { ...rest, tenant_id: tenantId, organization_id: organizationId }
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'wms.locations.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const schemaWithScope = locationUpdateSchema.merge(
          z.object({ id: z.string().uuid(), tenantId: z.string().uuid(), organizationId: z.string().uuid().optional() })
        )
        const parsed = (await parseScopedCommandInput(schemaWithScope, raw ?? {}, ctx, translate)) as Record<string, unknown>
        const id = resolveCrudRecordId(parsed, ctx, translate)
        if (!id) throw new CrudHttpError(400, { error: translate('wms.errors.id_required', 'Record identifier is required.') })
        const { tenantId, organizationId, ...rest } = parsed
        return { ...rest, id, tenant_id: tenantId, organization_id: organizationId }
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT

const locationListItemSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
  organizationId: z.string().uuid().nullable().optional(),
  warehouseId: z.string().uuid().nullable().optional(),
  code: z.string().nullable().optional(),
  type: z.string().nullable().optional(),
  parentId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().nullable().optional(),
  capacityUnits: z.number().nullable().optional(),
  capacityWeight: z.number().nullable().optional(),
  constraints: z.record(z.string(), z.unknown()).nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createWmsCrudOpenApi({
  resourceName: 'WarehouseLocation',
  pluralName: 'Warehouse locations',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(locationListItemSchema),
  create: {
    schema: locationCreateSchema,
    description: 'Creates a warehouse location scoped to the selected organization.',
  },
  update: {
    schema: locationUpdateSchema.merge(z.object({ id: z.string().uuid() })),
    responseSchema: defaultOkResponseSchema,
    description: 'Updates a warehouse location by id.',
  },
})
