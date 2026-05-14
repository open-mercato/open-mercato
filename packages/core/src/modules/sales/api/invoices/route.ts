import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { SalesInvoice } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { invoiceCreateSchema, invoiceUpdateSchema } from '../../data/validators'
import { createSalesCrudOpenApi, createPagedListResponseSchema, defaultDeleteRequestSchema } from '../openapi'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { z } from 'zod'

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
    GET: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
    POST: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_invoice,
    sortFieldMap: {
      invoiceNumber: 'invoice_number',
      status: 'status',
      issueDate: 'issue_date',
      dueDate: 'due_date',
      grandTotalGrossAmount: 'grand_total_gross_amount',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.orderId) filters.orderId = query.orderId
      if (query.search) {
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [
          { invoiceNumber: { $ilike: term } },
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
      response: ({ result }: { result: any }) => ({ invoiceId: result?.invoiceId ?? result?.id ?? null }),
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
      response: ({ result }: { result: any }) => ({ invoiceId: result?.invoiceId ?? result?.id ?? null }),
    },
    delete: {
      commandId: 'sales.invoices.delete',
      schema: rawBodySchema,
      mapInput: async ({ parsed, ctx }: { parsed: any; ctx: CrudCtx }) => {
        const { translate } = await resolveTranslations()
        const id = resolveCrudRecordId(parsed, ctx, translate)
        return { id }
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
  del: { schema: defaultDeleteRequestSchema, responseSchema: z.object({ ok: z.boolean() }), description: 'Delete an invoice' },
})
