import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { LEAVE_TYPES } from '../../data/entities'
import { HrLeaveAccrual } from '../../data/entities'
import { createHrCrudOpenApi, createPagedListResponseSchema } from '../openapi'
import { HR_LEAVE_ACCRUAL_ENTITY_ID } from '../../commands/leaveAccrual'
import '../../commands/leaveAccrual'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  leaveType: z.enum(LEAVE_TYPES).optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['hr.read'] },
}

export const metadata = { path: '/hr_management/leave-accruals', ...routeMetadata }

function monthRange(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, monthNumber - 1, 1))
  const end = new Date(Date.UTC(year, monthNumber, 0))
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrLeaveAccrual, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId' },
  indexer: { entityType: HR_LEAVE_ACCRUAL_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: HR_LEAVE_ACCRUAL_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'employee_id', 'leave_type', 'accrual_month', 'days', 'entitlement_id', 'source', 'note', 'created_at'],
    sortFieldMap: { employeeId: 'employee_id', leaveType: 'leave_type', accrualMonth: 'accrual_month', createdAt: 'created_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.employeeId ? { employee_id: { $eq: query.employeeId } } : {}),
      ...(query.leaveType ? { leave_type: { $eq: query.leaveType } } : {}),
      ...(query.month ? { accrual_month: { $gte: monthRange(query.month).start, $lte: monthRange(query.month).end } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.created_at ?? null }),
  },
})

export const GET = crud.GET

const itemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  leave_type: z.string(),
  accrual_month: z.string(),
  days: z.string(),
  entitlement_id: z.string().uuid().nullable().optional(),
  source: z.string(),
  note: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createHrCrudOpenApi({
  resourceName: 'Leave accrual', pluralName: 'Leave accruals', querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
})
