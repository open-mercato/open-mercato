import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { SalesInvoice } from '../../data/entities'
import { invoiceCreateSchema, invoiceUpdateSchema } from '../../data/validators'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { withScopedPayload } from '../utils'
import {
  createPagedListResponseSchema,
  createSalesCrudOpenApi,
  defaultDeleteRequestSchema,
} from '../openapi'
import {
  attachOrderContext,
  attachInvoiceLines,
  normalizeFinancialDocumentItem,
} from '../_documentListEnrichers'
import { E } from '#generated/entities.ids.generated'

const rawBodySchema = z.object({}).passthrough()

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    id: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
  POST: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: SalesInvoice,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: {
    entityType: E.sales.sales_invoice,
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_invoice,
    fields: [
      'id',
      'order_id',
      'invoice_number',
      'status_entry_id',
      'status',
      'issue_date',
      'due_date',
      'currency_code',
      'subtotal_net_amount',
      'subtotal_gross_amount',
      'discount_total_amount',
      'tax_total_amount',
      'grand_total_net_amount',
      'grand_total_gross_amount',
      'paid_total_amount',
      'outstanding_amount',
      'metadata',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      invoiceNumber: 'invoice_number',
      status: 'status',
      issueDate: 'issue_date',
      dueDate: 'due_date',
      grandTotalGrossAmount: 'grand_total_gross_amount',
      createdAt: 'created_at',
    },
    transformItem: (item: Record<string, unknown>) => normalizeFinancialDocumentItem(item, 'invoice'),
    buildFilters: async (query: z.infer<typeof listSchema>) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.orderId) filters.order_id = { $eq: query.orderId }
      if (query.search) {
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [
          { invoice_number: { $ilike: term } },
          { status: { $ilike: term } },
        ]
      }
      return filters
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      await attachOrderContext(payload as { items?: unknown }, ctx as never)
      await attachInvoiceLines(payload as { items?: unknown }, ctx as never)
    },
  },
  actions: {
    create: {
      commandId: 'sales.invoices.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base } = splitCustomFieldPayload(scoped)
        return invoiceCreateSchema.parse(base)
      },
    },
    update: {
      commandId: 'sales.invoices.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        const { base } = splitCustomFieldPayload(scoped)
        return invoiceUpdateSchema.parse(base)
      },
    },
    delete: {
      commandId: 'sales.invoices.delete',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return withScopedPayload(raw ?? {}, ctx, translate)
      },
    },
  },
})

export const metadata = crud.metadata
export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

const invoiceItemSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  status: z.string().nullable().optional(),
  issueDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  currencyCode: z.string(),
  grandTotalGrossAmount: z.string().optional(),
  grandTotalNetAmount: z.string().optional(),
  taxTotalAmount: z.string().optional(),
  paidTotalAmount: z.string().optional(),
  outstandingAmount: z.string().optional(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Invoice',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(invoiceItemSchema),
  create: { schema: invoiceCreateSchema, description: 'Create a new invoice' },
  update: { schema: invoiceUpdateSchema, responseSchema: z.object({ invoiceId: z.string().uuid() }), description: 'Update an invoice' },
  del: { schema: defaultDeleteRequestSchema, responseSchema: z.object({ invoiceId: z.string().uuid() }), description: 'Delete an invoice' },
})
