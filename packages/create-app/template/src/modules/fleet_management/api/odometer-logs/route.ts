import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { FleetVehicleOdometerLog } from '../../data/entities'
import { createOdometerLogSchema } from '../../data/validators'
import { createFleetCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { FLEET_ODOMETER_LOG_ENTITY_ID } from '../../commands/fleet'
import '../../commands/fleet'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  vehicleId: z.string().uuid().optional(),
  assignmentId: z.string().uuid().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['fleet.read'] },
  POST: { requireAuth: true, requireFeatures: ['fleet.write'] },
  PUT: { requireAuth: true, requireFeatures: ['fleet.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['fleet.write'] },
}

export const metadata = { path: '/fleet/odometer-logs', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: FleetVehicleOdometerLog, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: FLEET_ODOMETER_LOG_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FLEET_ODOMETER_LOG_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'vehicle_id', 'reading', 'recorded_at', 'source', 'assignment_id', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { reading: 'reading', recordedAt: 'recorded_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.vehicleId ? { vehicleId: { $eq: query.vehicleId } } : {}),
      ...(query.assignmentId ? { assignmentId: { $eq: query.assignmentId } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'fleet_management.odometer_logs.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createOdometerLogSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'fleet_management.odometer_logs.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createOdometerLogSchema.partial().extend({ id: z.string().uuid() }), raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'fleet_management.odometer_logs.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => { const { translate } = await resolveTranslations(); return { id: resolveCrudRecordId(parsed, ctx, translate) } },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const odometerLogItemSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), tenant_id: z.string().uuid(),
  vehicle_id: z.string().uuid(), reading: z.number(),
  recorded_at: z.string().nullable().optional(),
  source: z.string().nullable().optional(), assignment_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(), updated_at: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
})

export const openApi = createFleetCrudOpenApi({
  resourceName: 'OdometerLog', pluralName: 'OdometerLogs', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(odometerLogItemSchema),
  create: { schema: createOdometerLogSchema, description: 'Records a vehicle odometer reading.' },
  update: { schema: createOdometerLogSchema.partial().extend({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Updates a vehicle odometer reading.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a vehicle odometer reading.' },
})