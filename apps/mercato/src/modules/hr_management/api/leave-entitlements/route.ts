import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { LEAVE_TYPES } from '../../data/entities'
import { HrLeaveEntitlement } from '../../data/entities'
import { createLeaveEntitlementSchema, updateLeaveEntitlementSchema } from '../../data/validators'
import { createHrCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../openapi'
import { HR_LEAVE_ENTITLEMENT_ENTITY_ID } from '../../commands/leaveAccrual'
import '../../commands/leaveAccrual'

const rawBodySchema = z.object({}).passthrough()
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  leaveType: z.enum(LEAVE_TYPES).optional(),
  periodStart: z.string().optional(),
  periodEnd: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
  POST: { requireAuth: true, requireFeatures: ['hr.write'] },
  PUT: { requireAuth: true, requireFeatures: ['hr.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['hr.write'] },
}

export const metadata = { path: '/hr_management/leave-entitlements', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrLeaveEntitlement, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: HR_LEAVE_ENTITLEMENT_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_LEAVE_ENTITLEMENT_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'employee_id', 'leave_type', 'period_start', 'period_end', 'entitled_days', 'carry_over_days', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { employeeId: 'employee_id', leaveType: 'leave_type', periodStart: 'period_start', periodEnd: 'period_end', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.employeeId ? { employee_id: { $eq: query.employeeId } } : {}),
      ...(query.leaveType ? { leave_type: { $eq: query.leaveType } } : {}),
      ...(query.periodStart ? { period_end: { $gte: query.periodStart } } : {}),
      ...(query.periodEnd ? { period_start: { $lte: query.periodEnd } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'hr_management.leave_entitlements.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(createLeaveEntitlementSchema, raw ?? {}, ctx, translate) },
      response: ({ result }) => ({ id: result?.id ?? null, updatedAt: result?.updatedAt?.toISOString?.() ?? null }),
      status: 201,
    },
    update: {
      commandId: 'hr_management.leave_entitlements.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => { const { translate } = await resolveTranslations(); return parseScopedCommandInput(updateLeaveEntitlementSchema, raw ?? {}, ctx, translate) },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'hr_management.leave_entitlements.delete',
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

const itemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  leave_type: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  entitled_days: z.string(),
  carry_over_days: z.string(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Leave entitlement', pluralName: 'Leave entitlements', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createLeaveEntitlementSchema, description: 'Creates a leave entitlement.' },
  update: { schema: updateLeaveEntitlementSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a leave entitlement.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Soft-deletes a leave entitlement.' },
})
