import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { withOrConditions } from '../../lib/crudFilters'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { TransportVehicle } from '../../data/entities'
import { createVehicleSchema, updateVehicleSchema } from '../../data/validators'
import { createPagedListResponseSchema, createTransportCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { TRANSPORT_VEHICLE_ENTITY_ID } from '../../commands/transport'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  status: z.enum(['active', 'maintenance', 'out_of_service']).optional(),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['transport.read'] },
  POST: { requireAuth: true, requireFeatures: ['transport.write'] },
  PUT: { requireAuth: true, requireFeatures: ['transport.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['transport.write'] },
}

export const metadata = { path: '/transport_operations/vehicles', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: TransportVehicle, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: TRANSPORT_VEHICLE_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: TRANSPORT_VEHICLE_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'plate_number', 'vin', 'sequence_number', 'make', 'model', 'year', 'capacity', 'color', 'vehicle_type', 'current_odometer', 'notes', 'status', 'telematics_device_id', 'created_at', 'updated_at'],
    sortFieldMap: { plateNumber: 'plate_number', make: 'make', model: 'model', year: 'year', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => withOrConditions({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
    }, query.search ? [{ $or: [
      { plate_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
      { vin: { $ilike: `%${escapeLikePattern(query.search)}%` } },
      { make: { $ilike: `%${escapeLikePattern(query.search)}%` } },
      { model: { $ilike: `%${escapeLikePattern(query.search)}%` } },
    ] }] : []),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'transport_operations.vehicles.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createVehicleSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'transport_operations.vehicles.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateVehicleSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'transport_operations.vehicles.delete',
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

const vehicleListItemSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), tenant_id: z.string().uuid(),
  plate_number: z.string(), vin: z.string().nullable().optional(), sequence_number: z.string().nullable().optional(),
  make: z.string(), model: z.string(), year: z.number(), capacity: z.number(),
  color: z.string().nullable().optional(), vehicle_type: z.string().nullable().optional(),
  current_odometer: z.number().nullable().optional(), notes: z.string().nullable().optional(),
  status: z.enum(['active', 'maintenance', 'out_of_service']), telematics_device_id: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(), updated_at: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
})

export const openApi = createTransportCrudOpenApi({
  resourceName: 'Vehicle', pluralName: 'Vehicles', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(vehicleListItemSchema),
  create: { schema: createVehicleSchema, description: 'Creates a transport vehicle.' },
  update: { schema: updateVehicleSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a transport vehicle.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a transport vehicle.' },
})
