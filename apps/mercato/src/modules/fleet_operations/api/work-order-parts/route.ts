import { z } from 'zod'
import { FleetWorkOrderPart } from '../../data/entities'
import { buildOperationsCrudRoute } from '../crudRoute'

const crud = buildOperationsCrudRoute({
  entity: FleetWorkOrderPart,
  entityId: 'fleet_operations:fleet_work_order_part',
  resource: 'work_order_parts',
  fields: ['id', 'work_order_id', 'description', 'part_number', 'quantity', 'unit_cost', 'total_cost', 'created_at', 'updated_at'],
  sortFieldMap: { description: 'description', totalCost: 'total_cost', createdAt: 'created_at' },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = {
  tag: 'Fleet operations',
  summary: 'Manage work order parts',
  methods: {
    GET: { summary: 'List work order parts', responses: [{ status: 200, description: 'Parts' }] },
    POST: { summary: 'Add a part', responses: [{ status: 201, description: 'Created', schema: z.object({ id: z.string().uuid() }) }] },
    PUT: { summary: 'Update a part', responses: [{ status: 200, description: 'Updated', schema: z.object({ ok: z.boolean() }) }] },
    DELETE: { summary: 'Delete a part', responses: [{ status: 200, description: 'Deleted', schema: z.object({ ok: z.boolean() }) }] },
  },
}
