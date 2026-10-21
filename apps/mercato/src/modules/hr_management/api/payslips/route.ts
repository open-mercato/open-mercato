import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { HrPayslip } from '../../data/entities'
import '../../commands/payroll'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  payrollRunId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  status: z.enum(['draft', 'approved', 'paid']).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = { GET: { requireAuth: true, requireFeatures: ['hr.read'] } }
export const metadata = { path: '/hr_management/payslips', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrPayslip, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId' },
  indexer: { entityType: 'hr_management:hr_payslip' },
  list: {
    schema: listSchema,
    entityId: 'hr_management:hr_payslip',
    fields: ['id', 'organization_id', 'tenant_id', 'payroll_run_id', 'employee_id', 'gross_amount', 'deduction_amount', 'net_amount', 'status', 'worked_days', 'paid_leave_days', 'unpaid_leave_days', 'absence_days', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { employeeId: 'employee_id', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.payrollRunId ? { payroll_run_id: { $eq: query.payrollRunId } } : {}),
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
  payroll_run_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  gross_amount: z.string(),
  deduction_amount: z.string(),
  net_amount: z.string(),
  status: z.string(),
  worked_days: z.string().nullable().optional(),
  paid_leave_days: z.string().nullable().optional(),
  unpaid_leave_days: z.string().nullable().optional(),
  absence_days: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = {
  tag: 'HR',
  summary: 'Payslips',
  methods: {
    GET: {
      summary: 'Payslips for a run or an employee',
      responses: [{ status: 200, description: 'Payslips', schema: createPagedListResponseSchema(itemSchema) }],
    },
  },
}
