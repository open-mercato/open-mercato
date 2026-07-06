import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { SalesInvoice } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { invoiceCreateSchema, invoiceUpdateSchema } from '../../data/validators'
import { createSalesCrudOpenApi, createPagedListResponseSchema, defaultDeleteRequestSchema } from '../openapi'
import { parseScopedCommandInput, resolveCrudRecordId, withScopedPayload } from '../utils'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import {
  attachOrderContext,
  attachInvoiceLines,
  normalizeFinancialDocumentItem,
} from '../_documentListEnrichers'
import { z } from 'zod'

const rawBodySchema = z.object({}).passthrough()

type InvoiceCommandResult = {
  id?: string | null
  invoiceId?: string | null
}

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    id: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
    dateFrom: z.string().optional().refine((value) => !value || !Number.isNaN(new Date(value).getTime())),
    dateTo: z.string().optional().refine((value) => !value || !Number.isNaN(new Date(value).getTime())),
    totalGrossMin: z.coerce.number().optional(),
    totalGrossMax: z.coerce.number().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const crud = makeCrudRoute({
  orm: {
    entity: SalesInvoice,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.sales.sales_invoice },
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['sales.invoices.view'] },
    POST: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
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
      number: 'invoice_number',
      invoiceNumber: 'invoice_number',
      status: 'status',
      issueDate: 'issue_date',
      dueDate: 'due_date',
      grandTotalGrossAmount: 'grand_total_gross_amount',
      outstandingAmount: 'outstanding_amount',
      createdAt: 'created_at',
    },
    transformItem: (item: Record<string, unknown>) => normalizeFinancialDocumentItem(item, 'invoice'),
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.orderId) filters.order_id = { $eq: query.orderId }
      const issueDateRange: Record<string, Date> = {}
      if (query.dateFrom) {
        const from = new Date(query.dateFrom)
        if (!Number.isNaN(from.getTime())) issueDateRange.$gte = from
      }
      if (query.dateTo) {
        const to = new Date(query.dateTo)
        if (!Number.isNaN(to.getTime())) issueDateRange.$lte = to
      }
      if (Object.keys(issueDateRange).length) filters.issue_date = issueDateRange
      const grossRange: Record<string, unknown> = {}
      if (query.totalGrossMin != null) grossRange.$gte = query.totalGrossMin
      if (query.totalGrossMax != null) grossRange.$lte = query.totalGrossMax
      if (Object.keys(grossRange).length) filters.grand_total_gross_amount = grossRange
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
      mapInput: async ({ raw, ctx }: { raw: unknown; ctx: CrudCtx }) => {
        const { translate } = await resolveTranslations()
        const { base, custom } = splitCustomFieldPayload(raw ?? {})
        const parsed = parseScopedCommandInput(
          invoiceCreateSchema,
          Object.keys(custom).length ? { ...base, customFields: custom } : base,
          ctx,
          translate,
        )
        return parsed
      },
      response: ({ result }: { result: InvoiceCommandResult | null | undefined }) => ({
        invoiceId: result?.invoiceId ?? result?.id ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'sales.invoices.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }: { raw: unknown; ctx: CrudCtx }) => {
        const { translate } = await resolveTranslations()
        const { base, custom } = splitCustomFieldPayload(raw ?? {})
        const parsed = parseScopedCommandInput(
          invoiceUpdateSchema,
          Object.keys(custom).length ? { ...base, customFields: custom } : base,
          ctx,
          translate,
        )
        return parsed
      },
      response: ({ result }: { result: InvoiceCommandResult | null | undefined }) => ({
        invoiceId: result?.invoiceId ?? result?.id ?? null,
      }),
    },
    delete: {
      commandId: 'sales.invoices.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }: { parsed: unknown; ctx: CrudCtx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        return withScopedPayload({ id }, ctx, translate)
      },
      response: () => ({ ok: true }),
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
  invoiceNumber: z.string().nullable(),
  status: z.string().nullable().optional(),
  statusEntryId: z.string().uuid().nullable().optional(),
  issueDate: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  currencyCode: z.string().nullable(),
  orderId: z.string().uuid().nullable().optional(),
  order: z.object({ id: z.string().uuid(), orderNumber: z.string().nullable() }).nullable().optional(),
  customerEntityId: z.string().uuid().nullable().optional(),
  customerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  subtotalNetAmount: z.string().nullable().optional(),
  subtotalGrossAmount: z.string().nullable().optional(),
  discountTotalAmount: z.string().nullable().optional(),
  taxTotalAmount: z.string().nullable().optional(),
  grandTotalGrossAmount: z.string().nullable().optional(),
  grandTotalNetAmount: z.string().nullable().optional(),
  paidTotalAmount: z.string().nullable().optional(),
  outstandingAmount: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  lines: z.array(z.record(z.string(), z.unknown())).optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Invoice',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(invoiceItemSchema),
  create: { schema: invoiceCreateSchema, description: 'Create a new invoice' },
  update: { schema: invoiceUpdateSchema, responseSchema: z.object({ invoiceId: z.string().uuid() }), description: 'Update an invoice' },
  del: { schema: defaultDeleteRequestSchema, responseSchema: z.object({ ok: z.boolean() }), description: 'Delete an invoice' },
})
