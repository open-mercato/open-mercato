import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { HrEmployeeLoan } from '../../data/entities'
import '../../commands/payroll'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  employeeId: z.string().uuid().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'settling', 'settled']).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = { GET: { requireAuth: true, requireFeatures: ['hr.read'] } }
export const metadata = { path: '/hr_management/loans', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrEmployeeLoan, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: 'hr_management:hr_employee_loan' },
  list: {
    schema: listSchema,
    entityId: 'hr_management:hr_employee_loan',
    fields: ['id', 'organization_id', 'tenant_id', 'employee_id', 'principal_amount', 'currency_code', 'instalment_count', 'instalment_amount', 'first_due_on', 'outstanding_amount', 'reason', 'status', 'approval_request_id', 'created_at', 'updated_at'],
    sortFieldMap: { firstDueOn: 'first_due_on', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.employeeId ? { employee_id: { $eq: query.employeeId } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
})

export const GET = crud.GET

const itemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  principal_amount: z.string(),
  currency_code: z.string(),
  instalment_count: z.number(),
  instalment_amount: z.string(),
  first_due_on: z.string().nullable().optional(),
  outstanding_amount: z.string(),
  reason: z.string().nullable().optional(),
  status: z.string(),
  approval_request_id: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = {
  tag: 'HR',
  summary: 'Employee loans',
  methods: {
    GET: {
      summary: 'Loans with their outstanding balance',
      responses: [{ status: 200, description: 'Loans', schema: createPagedListResponseSchema(itemSchema) }],
    },
  },
}
