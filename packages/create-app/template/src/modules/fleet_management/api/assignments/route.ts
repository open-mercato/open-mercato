import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { FleetVehicleAssignment } from '../../data/entities'
import { updateVehicleAssignmentSchema } from '../../data/validators'
import { createFleetCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { FLEET_ASSIGNMENT_ENTITY_ID } from '../../commands/fleet'
import '../../commands/assignments'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  vehicleId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  status: z.enum(['pending_approval', 'active', 'returned', 'rejected', 'cancelled']).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['fleet.read'] },
  PUT: { requireAuth: true, requireFeatures: ['fleet.assign'] },
  DELETE: { requireAuth: true, requireFeatures: ['fleet.assign'] },
}

export const metadata = { path: '/fleet_management/assignments', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: FleetVehicleAssignment, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: FLEET_ASSIGNMENT_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: FLEET_ASSIGNMENT_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'vehicle_id', 'employee_id', 'approval_request_id', 'status', 'assigned_at', 'due_return_at', 'returned_at', 'handover_odometer', 'return_odometer', 'custody_notes', 'created_at', 'updated_at'],
    sortFieldMap: { assignedAt: 'assigned_at', dueReturnAt: 'due_return_at', returnedAt: 'returned_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.vehicleId ? { vehicleId: { $eq: query.vehicleId } } : {}),
      ...(query.employeeId ? { employeeId: { $eq: query.employeeId } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    update: {
      commandId: 'fleet_management.assignments.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateVehicleAssignmentSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'fleet_management.assignments.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => { const { translate } = await resolveTranslations(); return { id: resolveCrudRecordId(parsed, ctx, translate) } },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const assignmentListItemSchema = z.object({
  id: z.string().uuid(), organization_id: z.string().uuid(), tenant_id: z.string().uuid(),
  vehicle_id: z.string().uuid(), employee_id: z.string().uuid(),
  approval_request_id: z.string().uuid().nullable().optional(),
  status: z.enum(['pending_approval', 'active', 'returned', 'rejected', 'cancelled']),
  assigned_at: z.string().nullable().optional(), due_return_at: z.string().nullable().optional(),
  returned_at: z.string().nullable().optional(),
  handover_odometer: z.number().nullable().optional(), return_odometer: z.number().nullable().optional(),
  custody_notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(), updated_at: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
})

export const openApi = createFleetCrudOpenApi({
  resourceName: 'Assignment', pluralName: 'Assignments', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(assignmentListItemSchema),
  create: { schema: z.object({}), description: 'Custody assignments start through the handover endpoint.' },
  update: { schema: updateVehicleAssignmentSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a custody assignment.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a custody assignment.' },
})