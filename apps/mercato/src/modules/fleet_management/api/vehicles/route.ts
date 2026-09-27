import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { FleetVehicle } from '../../data/entities'
import { createVehicleSchema, updateVehicleSchema } from '../../data/validators'
import { createFleetCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { FLEET_VEHICLE_ENTITY_ID } from '../../commands/fleet'
import '../../commands/fleet'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  status: z.enum(['active', 'assigned', 'maintenance', 'out_of_service']).optional(),
  assignedEmployeeId: z.string().uuid().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['fleet.read'] },
  POST: { requireAuth: true, requireFeatures: ['fleet.write'] },
  PUT: { requireAuth: true, requireFeatures: ['fleet.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['fleet.write'] },
}

export const metadata = { path: '/fleet_management/vehicles', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: FleetVehicle, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: FLEET_VEHICLE_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FLEET_VEHICLE_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'plate_number', 'sequence_number', 'make', 'model', 'year', 'color', 'vehicle_type', 'status', 'current_odometer', 'assigned_employee_id', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { plateNumber: 'plate_number', make: 'make', model: 'model', year: 'year', currentOdometer: 'current_odometer', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
      ...(query.assignedEmployeeId ? { assignedEmployeeId: { $eq: query.assignedEmployeeId } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'fleet_management.vehicles.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createVehicleSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'fleet_management.vehicles.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateVehicleSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'fleet_management.vehicles.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => { const { translate } = await resolveTranslations(); return { id: resolveCrudRecordId(parsed, ctx, translate) } },
      response: () => ({ ok: true }),
    },
  },
})

const vehicleListItemSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), tenant_id: z.string().uuid(),
  plate_number: z.string(), sequence_number: z.string().nullable().optional(),
  make: z.string(), model: z.string(), year: z.number(),
  color: z.string().nullable().optional(), vehicle_type: z.string().nullable().optional(),
  status: z.enum(['active', 'assigned', 'maintenance', 'out_of_service']),
  current_odometer: z.number(), assigned_employee_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(), updated_at: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
})

export const openApi = createFleetCrudOpenApi({
  resourceName: 'Vehicle', pluralName: 'Vehicles', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(vehicleListItemSchema),
  create: { schema: createVehicleSchema, description: 'Creates a fleet vehicle.' },
  update: { schema: updateVehicleSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a fleet vehicle.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a fleet vehicle.' },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE