import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { createPagedListResponseSchema } from '@open-mercato/shared/lib/openapi/crud'
import { GlBankStatement } from '../../data/entities'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  cashAccountId: z.string().uuid().optional(),
  status: z.enum(['imported', 'reconciled']).optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
}

export const metadata = { path: '/financial/bank-statements', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: GlBankStatement, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId' },
  indexer: { entityType: 'financial:gl_bank_statement' },
  list: {
    schema: listSchema,
    entityId: 'financial:gl_bank_statement',
    fields: ['id', 'organization_id', 'tenant_id', 'cash_account_id', 'file_name', 'period_start', 'period_end', 'status', 'imported_by', 'created_at', 'updated_at'],
    sortFieldMap: { createdAt: 'created_at', updatedAt: 'updated_at', status: 'status' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.cashAccountId ? { cash_account_id: { $eq: query.cashAccountId } } : {}),
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
  cash_account_id: z.string().uuid(),
  file_name: z.string().nullable().optional(),
  period_start: z.string().nullable().optional(),
  period_end: z.string().nullable().optional(),
  status: z.string(),
  imported_by: z.string().uuid().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = {
  tag: 'Financial',
  summary: 'Bank statements',
  methods: {
    GET: {
      summary: 'Imported bank statements',
      responses: [{ status: 200, description: 'Statements', schema: createPagedListResponseSchema(itemSchema) }],
    },
  },
}
