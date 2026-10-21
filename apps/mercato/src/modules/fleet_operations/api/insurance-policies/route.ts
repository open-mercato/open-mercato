import { z } from 'zod'
import { FleetInsurancePolicy } from '../../data/entities'
import { buildOperationsCrudRoute } from '../crudRoute'

const crud = buildOperationsCrudRoute({
  entity: FleetInsurancePolicy,
  entityId: 'fleet_operations:fleet_insurance_policy',
  resource: 'insurance_policies',
  fields: [
    'id',
    'vehicle_id',
    'policy_number',
    'insurer_name',
    'coverage_type',
    'start_date',
    'end_date',
    'premium_amount',
    'currency_code',
    'status',
    'notes',
    'created_at',
    'updated_at',
  ],
  sortFieldMap: {
    policyNumber: 'policy_number',
    insurerName: 'insurer_name',
    startDate: 'start_date',
    endDate: 'end_date',
    premiumAmount: 'premium_amount',
    status: 'status',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  buildExtraFilters: (query) => ({
    ...(query.coverageType ? { coverage_type: { $eq: query.coverageType } } : {}),
    ...(query.expiringWithinDays !== undefined
      ? { end_date: { $lte: new Date(Date.now() + Number(query.expiringWithinDays) * 24 * 60 * 60 * 1000) } }
      : {}),
  }),
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = {
  tag: 'Fleet operations',
  summary: 'Manage vehicle insurance policies',
  methods: {
    GET: { summary: 'List insurance policies', query: z.object({ vehicleId: z.string().uuid().optional(), status: z.string().optional() }), responses: [{ status: 200, description: 'Policies' }] },
    POST: { summary: 'Record an insurance policy', responses: [{ status: 201, description: 'Created', schema: z.object({ id: z.string().uuid() }) }] },
    PUT: { summary: 'Update an insurance policy', responses: [{ status: 200, description: 'Updated', schema: z.object({ ok: z.boolean() }) }] },
    DELETE: { summary: 'Delete an insurance policy', responses: [{ status: 200, description: 'Deleted', schema: z.object({ ok: z.boolean() }) }] },
  },
}
