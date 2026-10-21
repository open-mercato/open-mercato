import { z } from 'zod'
import { FleetMaintenanceSchedule } from '../../data/entities'
import { buildOperationsCrudRoute } from '../crudRoute'

const crud = buildOperationsCrudRoute({
  entity: FleetMaintenanceSchedule,
  entityId: 'fleet_operations:fleet_maintenance_schedule',
  resource: 'maintenance_schedules',
  fields: [
    'id',
    'vehicle_id',
    'name',
    'description',
    'interval_type',
    'interval_odometer',
    'interval_days',
    'last_service_odometer',
    'last_service_at',
    'next_due_odometer',
    'next_due_at',
    'is_active',
    'created_at',
    'updated_at',
  ],
  sortFieldMap: {
    name: 'name',
    intervalType: 'interval_type',
    nextDueAt: 'next_due_at',
    nextDueOdometer: 'next_due_odometer',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  buildExtraFilters: (query) => ({
    ...(query.isActive !== undefined ? { is_active: { $eq: query.isActive } } : {}),
  }),
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = {
  tag: 'Fleet operations',
  summary: 'Manage preventive maintenance schedules',
  methods: {
    GET: {
      summary: 'List maintenance schedules',
      query: z.object({ vehicleId: z.string().uuid().optional() }),
      responses: [{ status: 200, description: 'Schedules' }],
    },
    POST: {
      summary: 'Create a maintenance schedule',
      responses: [{ status: 201, description: 'Created', schema: z.object({ id: z.string().uuid() }) }],
    },
    PUT: {
      summary: 'Update a maintenance schedule',
      responses: [{ status: 200, description: 'Updated', schema: z.object({ ok: z.boolean() }) }],
    },
    DELETE: {
      summary: 'Soft-delete a maintenance schedule',
      responses: [{ status: 200, description: 'Deleted', schema: z.object({ ok: z.boolean() }) }],
    },
  },
}
