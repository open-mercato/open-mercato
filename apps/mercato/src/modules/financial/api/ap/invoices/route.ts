import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { parseScopedCommandInput, resolveCrudRecordId } from '@open-mercato/shared/lib/api/scoped'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ApVendorInvoice } from '../../../data/entities'
import { createVendorInvoiceSchema, updateVendorInvoiceSchema } from '../../../data/validators'
import { createFinancialCrudOpenApi, createPagedListResponseSchema, defaultOkResponseSchema } from '../../openapi'
import { AP_VENDOR_INVOICE_ENTITY_ID } from '../../../commands/ap'
import '../../../commands/ap'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  id: z.string().uuid().optional(),
  ids: z.string().optional(),
  vendorId: z.string().uuid().optional(),
  status: z.enum(['draft', 'posted', 'paid', 'void']).optional(),
  search: z.string().optional(),
  sortField: z.string().optional(),
  sortDir: z.enum(['asc', 'desc']).optional(),
}).passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['financial.read'] },
  POST: { requireAuth: true, requireFeatures: ['financial.write'] },
  PUT: { requireAuth: true, requireFeatures: ['financial.write'] },
  DELETE: { requireAuth: true, requireFeatures: ['financial.write'] },
}

export const metadata = { path: '/financial/ap/invoices', ...routeMetadata }

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: { entity: ApVendorInvoice, idField: 'id', orgField: 'organizationId', tenantField: 'tenantId', softDeleteField: 'deletedAt' },
  indexer: { entityType: AP_VENDOR_INVOICE_ENTITY_ID },
  list: {
    schema: listSchema,
    entityId: AP_VENDOR_INVOICE_ENTITY_ID,
    fields: ['id', 'organization_id', 'tenant_id', 'vendor_id', 'internal_number', 'vendor_invoice_number', 'issue_date', 'due_date', 'currency_code', 'subtotal_net_amount', 'tax_total_amount', 'grand_total_gross_amount', 'withholding_code', 'withholding_amount', 'status', 'posted_entry_id', 'notes', 'created_at', 'updated_at'],
    sortFieldMap: { internalNumber: 'internal_number', issueDate: 'issue_date', dueDate: 'due_date', status: 'status', createdAt: 'created_at', updatedAt: 'updated_at' },
    buildFilters: (query) => ({
      ...(query.id ? { id: { $eq: query.id } } : {}),
      ...(query.ids ? { id: { $in: query.ids.split(',').map((value) => value.trim()).filter(Boolean) } } : {}),
      ...(query.vendorId ? { vendor_id: { $eq: query.vendorId } } : {}),
      ...(query.status ? { status: { $eq: query.status } } : {}),
      ...(query.search ? { $or: [
        { internal_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
        { vendor_invoice_number: { $ilike: `%${escapeLikePattern(query.search)}%` } },
      ] } : {}),
    }),
    transformItem: (item) => ({ ...item, updatedAt: item.updated_at ?? null }),
  },
  actions: {
    create: {
      commandId: 'financial.ap_vendor_invoices.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(createVendorInvoiceSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }) => ({ id: result?.id ?? null }),
      status: 201,
    },
    update: {
      commandId: 'financial.ap_vendor_invoices.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(updateVendorInvoiceSchema, raw ?? {}, ctx, translate)
      },
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'financial.ap_vendor_invoices.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }) => {
        const { translate } = await resolveTranslations()
        return { id: resolveCrudRecordId(parsed, ctx, translate) }
      },
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
  vendor_id: z.string().uuid(),
  internal_number: z.string(),
  vendor_invoice_number: z.string().nullable().optional(),
  issue_date: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  currency_code: z.string(),
  subtotal_net_amount: z.string().nullable().optional(),
  tax_total_amount: z.string().nullable().optional(),
  grand_total_gross_amount: z.string().nullable().optional(),
  withholding_code: z.string().nullable().optional(),
  withholding_amount: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  posted_entry_id: z.string().uuid().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createFinancialCrudOpenApi({
  resourceName: 'Vendor invoice',
  pluralName: 'Vendor invoices',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(itemSchema),
  create: { schema: createVendorInvoiceSchema, description: 'Creates a draft vendor invoice with its lines.' },
  update: { schema: updateVendorInvoiceSchema, responseSchema: defaultOkResponseSchema, description: 'Updates a draft vendor invoice.' },
  del: { schema: z.object({ id: z.string().uuid() }), responseSchema: defaultOkResponseSchema, description: 'Deletes a draft vendor invoice.' },
})
