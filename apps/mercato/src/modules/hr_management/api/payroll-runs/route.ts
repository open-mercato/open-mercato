import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { HrPayrollRun } from '../../data/entities'
import '../../commands/payroll'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  status: z.enum(['draft', 'calculated', 'submitted', 'approved', 'paid', 'closed']).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = { GET: { requireAuth: true, requireFeatures: ['hr.read'] } }
export const metadata = { path: '/hr_management/payroll-runs', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: HrPayrollRun, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: 'hr_management:hr_payroll_run' },
  list: {
    schema: listSchema,
    entityId: 'hr_management:hr_payroll_run',
    fields: ['id', 'organization_id', 'tenant_id', 'period_start', 'period_end', 'payment_date', 'status', 'currency_code', 'gross_total', 'deduction_total', 'net_total', 'employee_count', 'calculated_at', 'approval_request_id', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { periodStart: 'period_start', periodEnd: 'period_end', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
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
  period_start: z.string().nullable().optional(),
  period_end: z.string().nullable().optional(),
  payment_date: z.string().nullable().optional(),
  status: z.string(),
  currency_code: z.string(),
  gross_total: z.string().nullable().optional(),
  deduction_total: z.string().nullable().optional(),
  net_total: z.string().nullable().optional(),
  employee_count: z.number().nullable().optional(),
  calculated_at: z.string().nullable().optional(),
  approval_request_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = {
  tag: 'HR',
  summary: 'Payroll runs',
  methods: {
    GET: {
      summary: 'Payroll runs with their totals',
      responses: [{ status: 200, description: 'Runs', schema: createPagedListResponseSchema(itemSchema) }],
    },
  },
}
