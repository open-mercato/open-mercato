import { z } from 'zod'
import { FleetTrafficViolation } from '../../data/entities'
import { buildOperationsCrudRoute } from '../crudRoute'

const crud = buildOperationsCrudRoute({
  entity: FleetTrafficViolation,
  entityId: 'fleet_operations:fleet_traffic_violation',
  resource: 'traffic_violations',
  fields: [
    'id',
    'vehicle_id',
    'driver_employee_id',
    'violation_number',
    'occurred_at',
    'location',
    'description',
    'fine_amount',
    'currency_code',
    'status',
    'paid_at',
    'payroll_deduction_requested',
    'notes',
    'created_at',
    'updated_at',
  ],
  sortFieldMap: {
    violationNumber: 'violation_number',
    occurredAt: 'occurred_at',
    fineAmount: 'fine_amount',
    status: 'status',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  buildExtraFilters: (query) => ({
    ...(query.driverEmployeeId ? { driver_employee_id: { $eq: query.driverEmployeeId } } : {}),
  }),
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = {
  tag: 'Fleet operations',
  summary: 'Manage traffic violations',
  methods: {
    GET: { summary: 'List traffic violations', query: z.object({ vehicleId: z.string().uuid().optional(), status: z.string().optional() }), responses: [{ status: 200, description: 'Violations' }] },
    POST: { summary: 'Record a violation', responses: [{ status: 201, description: 'Created', schema: z.object({ id: z.string().uuid() }) }] },
    PUT: { summary: 'Update a violation', responses: [{ status: 200, description: 'Updated', schema: z.object({ ok: z.boolean() }) }] },
    DELETE: { summary: 'Delete a violation', responses: [{ status: 200, description: 'Deleted', schema: z.object({ ok: z.boolean() }) }] },
  },
}
