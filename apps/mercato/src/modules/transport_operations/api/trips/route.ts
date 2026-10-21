import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { TransportTripSchedule } from '../../data/entities'
import { createTripScheduleSchema, updateTripScheduleSchema } from '../../data/validators'
import { createPagedListResponseSchema, createTransportCrudOpenApi, defaultOkResponseSchema } from '../openapi'
import { TRANSPORT_TRIP_ENTITY_ID } from '../../commands/transport'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(), ids: z.string().optional(), routeId: z.string().uuid().optional(), vehicleId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(), status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']).optional(),
  startFrom: z.string().optional(), startTo: z.string().optional(), sortField: z.string().optional(), sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['transport.read'] },
  POST: { requireAuth: true, requireFeatures: ['transport.write'] },
  PUT: { requireAuth: true, requireFeatures: ['transport.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['transport.write'] },
}
export const metadata = { path: '/transport_operations/trips', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: TransportTripSchedule, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: TRANSPORT_TRIP_ENTITY_ID },
  list: {
    schema: listSchema, entityId: TRANSPORT_TRIP_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'route_id', 'vehicle_id', 'driver_id', 'scheduled_start_time', 'scheduled_end_time', 'actual_start_time', 'actual_end_time', 'status', 'cancellation_reason', 'created_at', 'updated_at'],
    sortFieldMap: { scheduledStartTime: 'scheduled_start_time', scheduledEndTime: 'scheduled_end_time', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.routeId ? { route_id: { $eq: query.routeId } } : {}),
      ...(query.vehicleId ? { vehicle_id: { $eq: query.vehicleId } } : {}),
      ...(query.driverId ? { driver_id: { $eq: query.driverId } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
      ...(query.startFrom ? { scheduled_start_time: { $gte: query.startFrom } } : {}),
      ...(query.startTo ? { scheduled_start_time: { $lte: query.startTo } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'transport_operations.trips.create', schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createTripScheduleSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }), status: 201,
    },
    update: {
      commandId: 'transport_operations.trips.update', schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateTripScheduleSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'transport_operations.trips.delete', schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => { const { translate } = await resolveTranslations(); return { id: resolveCrudRecordId(parsed, ctx, translate) } },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const tripListItemSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), tenant_id: z.string().uuid(), route_id: z.string().uuid(),
  vehicle_id: z.string().uuid(), driver_id: z.string().uuid(), scheduled_start_time: z.string(), scheduled_end_time: z.string(),
  actual_start_time: z.string().nullable().optional(), actual_end_time: z.string().nullable().optional(),
  status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled']), created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
})

export const openApi = createTransportCrudOpenApi({
  resourceName: 'Trip', pluralName: 'Trips', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(tripListItemSchema),
  create: { schema: createTripScheduleSchema, description: 'Schedules a trip after checking vehicle and driver availability.' },
  update: { schema: updateTripScheduleSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a scheduled trip.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a trip schedule.' },
})
