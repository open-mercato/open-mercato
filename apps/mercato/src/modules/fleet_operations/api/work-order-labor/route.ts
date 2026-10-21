import { z } from 'zod'
import { FleetWorkOrderLabor } from '../../data/entities'
import { buildOperationsCrudRoute } from '../crudRoute'

const crud = buildOperationsCrudRoute({
  entity: FleetWorkOrderLabor,
  entityId: 'fleet_operations:fleet_work_order_labor',
  resource: 'work_order_labor',
  fields: ['id', 'work_order_id', 'description', 'hours', 'rate', 'total_cost', 'created_at', 'updated_at'],
  sortFieldMap: { description: 'description', totalCost: 'total_cost', createdAt: 'created_at' },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = {
  tag: 'Fleet operations',
  summary: 'Manage work order labor',
  methods: {
    GET: { summary: 'List labor entries', responses: [{ status: 200, description: 'Labor' }] },
    POST: { summary: 'Add a labor entry', responses: [{ status: 201, description: 'Created', schema: z.object({ id: z.string().uuid() }) }] },
    PUT: { summary: 'Update a labor entry', responses: [{ status: 200, description: 'Updated', schema: z.object({ ok: z.boolean() }) }] },
    DELETE: { summary: 'Delete a labor entry', responses: [{ status: 200, description: 'Deleted', schema: z.object({ ok: z.boolean() }) }] },
  },
}
