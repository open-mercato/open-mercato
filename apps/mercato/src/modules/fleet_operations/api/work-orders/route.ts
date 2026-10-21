import { z } from 'zod'
import { FleetWorkOrder } from '../../data/entities'
import { buildOperationsCrudRoute } from '../crudRoute'

const crud = buildOperationsCrudRoute({
  entity: FleetWorkOrder,
  entityId: 'fleet_operations:fleet_work_order',
  resource: 'work_orders',
  fields: [
    'id',
    'vehicle_id',
    'schedule_id',
    'work_order_number',
    'title',
    'description',
    'status',
    'priority',
    'type',
    'odometer',
    'vendor_name',
    'opened_at',
    'started_at',
    'completed_at',
    'downtime_minutes',
    'labor_cost',
    'parts_cost',
    'total_cost',
    'currency_code',
    'notes',
    'created_at',
    'updated_at',
  ],
  sortFieldMap: {
    workOrderNumber: 'work_order_number',
    title: 'title',
    status: 'status',
    priority: 'priority',
    openedAt: 'opened_at',
    completedAt: 'completed_at',
    totalCost: 'total_cost',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  buildExtraFilters: (query) => ({
    ...(query.priority ? { priority: { $eq: query.priority } } : {}),
    ...(query.type ? { type: { $eq: query.type } } : {}),
    ...(query.scheduleId ? { schedule_id: { $eq: query.scheduleId } } : {}),
  }),
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = {
  tag: 'Fleet operations',
  summary: 'Manage fleet work orders',
  methods: {
    GET: {
      summary: 'List work orders',
      query: z.object({ vehicleId: z.string().uuid().optional(), status: z.string().optional() }),
      responses: [{ status: 200, description: 'Work orders' }],
    },
    POST: {
      summary: 'Create a work order',
      responses: [{ status: 201, description: 'Created', schema: z.object({ id: z.string().uuid(), updatedAt: z.string().nullable() }) }],
    },
    PUT: {
      summary: 'Update a work order (use the complete action to close one)',
      responses: [{ status: 200, description: 'Updated', schema: z.object({ ok: z.boolean() }) }],
    },
    DELETE: {
      summary: 'Soft-delete a work order',
      responses: [{ status: 200, description: 'Deleted', schema: z.object({ ok: z.boolean() }) }],
    },
  },
}
