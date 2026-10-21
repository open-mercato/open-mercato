import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { ApPayment } from '../../../data/entities'
import { createFinancialCrudOpenApi, createPagedListResponseSchema } from '../../openapi'
import { AP_PAYMENT_ENTITY_ID } from '../../../commands/ap'
import '../../../commands/ap'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  vendorId: z.string().uuid().optional(),
  status: z.enum(['posted', 'void']).optional(),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
}

export const metadata = { path: '/financial/ap/payments', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: ApPayment, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: AP_PAYMENT_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: AP_PAYMENT_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'vendor_id', 'payment_number', 'payment_date', 'currency_code', 'gross_amount', 'withholding_code', 'withholding_amount', 'net_amount', 'method', 'reference', 'status', 'posted_entry_id', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { paymentNumber: 'payment_number', paymentDate: 'payment_date', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.vendorId ? { vendor_id: { $eq: query.vendorId } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
      ...(query.search ? { $or: [
        { payment_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        { reference: { $ilike: `%${escapeLikePattern(query.search)}%` } },
      ] } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
})

export const GET = crud.GET

const itemSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  vendor_id: z.string().uuid(),
  payment_number: z.string(),
  payment_date: z.string().nullable().optional(),
  currency_code: z.string(),
  gross_amount: z.string().nullable().optional(),
  withholding_code: z.string().nullable().optional(),
  withholding_amount: z.string().nullable().optional(),
  net_amount: z.string().nullable().optional(),
  method: z.string().nullable().optional(),
  reference: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  posted_entry_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFinancialCrudOpenApi({
  resourceName: 'Vendor payment',
  pluralName: 'Vendor payments',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
})
