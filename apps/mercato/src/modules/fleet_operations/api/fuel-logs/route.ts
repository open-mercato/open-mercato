import { z } from 'zod'
import { FleetFuelLog } from '../../data/entities'
import { buildOperationsCrudRoute } from '../crudRoute'

const crud = buildOperationsCrudRoute({
  entity: FleetFuelLog,
  entityId: 'fleet_operations:fleet_fuel_log',
  resource: 'fuel_logs',
  fields: [
    'id',
    'vehicle_id',
    'logged_at',
    'odometer',
    'liters',
    'unit_price',
    'total_cost',
    'fuel_type',
    'station_name',
    'full_tank',
    'driver_employee_id',
    'notes',
    'created_at',
    'updated_at',
  ],
  sortFieldMap: {
    loggedAt: 'logged_at',
    odometer: 'odometer',
    totalCost: 'total_cost',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  buildExtraFilters: (query) => ({
    ...(query.fuelType ? { fuel_type: { $eq: query.fuelType } } : {}),
    ...(query.driverEmployeeId ? { driver_employee_id: { $eq: query.driverEmployeeId } } : {}),
  }),
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = {
  tag: 'Fleet operations',
  summary: 'Manage fuel logs',
  methods: {
    GET: { summary: 'List fuel logs', query: z.object({ vehicleId: z.string().uuid().optional() }), responses: [{ status: 200, description: 'Fuel logs' }] },
    POST: { summary: 'Record a fuel purchase', responses: [{ status: 201, description: 'Created', schema: z.object({ id: z.string().uuid() }) }] },
    PUT: { summary: 'Update a fuel log', responses: [{ status: 200, description: 'Updated', schema: z.object({ ok: z.boolean() }) }] },
    DELETE: { summary: 'Delete a fuel log', responses: [{ status: 200, description: 'Deleted', schema: z.object({ ok: z.boolean() }) }] },
  },
}
