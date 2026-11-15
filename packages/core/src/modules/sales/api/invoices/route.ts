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
import { E } from '#generated/entities.ids.generated'

const rawBodySchema = z.object({}).passthrough()

/**
 * Fold `cf_*` / `customFields` input into `customFields`, the same way the order
 * and quote routes do, so the command stores it inside its transaction.
 */
function withFoldedCustomFields(payload: unknown): Record<string, unknown> {
  const { base, custom } = splitCustomFieldPayload(payload)
  return Object.keys(custom).length ? { ...base, customFields: custom } : base
}

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
  actions: {
    create: {
      commandId: 'sales.invoices.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return invoiceCreateSchema.parse(withFoldedCustomFields(scoped))
      },
    },
    update: {
      commandId: 'sales.invoices.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const scoped = withScopedPayload(raw ?? {}, ctx, translate)
        return invoiceUpdateSchema.parse(withFoldedCustomFields(scoped))
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

const customFieldsDescription =
  'Custom field values keyed by field key. `cf_<key>`, `cf:<key>` and `customValues` body keys are folded in. Rich-text values are sanitized; values are not validated against the field definitions.'

const invoiceCreateRequestSchema = invoiceCreateSchema.extend({
  customFields: z.record(z.string(), z.unknown()).nullable().optional().describe(customFieldsDescription),
})

const invoiceUpdateRequestSchema = invoiceUpdateSchema.extend({
  customFields: z.record(z.string(), z.unknown()).nullable().optional().describe(customFieldsDescription),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Invoice',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(invoiceItemSchema),
  create: {
    schema: invoiceCreateRequestSchema,
    description:
      'Create a new invoice. Amounts are stored as sent. Line unit prices, tax and totals, and the header taxTotalAmount, subtotalNetAmount and grandTotalNetAmount may be negative; a line with a negative amount must send totalNetAmount and totalGrossAmount.',
  },
  update: {
    schema: invoiceUpdateRequestSchema,
    responseSchema: z.object({ invoiceId: z.string().uuid() }),
    description:
      'Update an invoice. Answers 404 when the invoice is missing or outside the request organization, and 403 when its tenant or organization is outside the caller scope.',
  },
  del: { schema: defaultDeleteRequestSchema, responseSchema: z.object({ invoiceId: z.string().uuid() }), description: 'Delete an invoice' },
})
