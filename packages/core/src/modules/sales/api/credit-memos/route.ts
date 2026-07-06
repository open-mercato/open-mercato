import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { SalesCreditMemo } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { creditMemoCreateSchema, creditMemoUpdateSchema } from '../../data/validators'
import { createSalesCrudOpenApi, createPagedListResponseSchema, defaultDeleteRequestSchema } from '../openapi'
import { parseScopedCommandInput, resolveCrudRecordId, withScopedPayload } from '../utils'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import {
  attachOrderContext,
  attachCreditMemoLines,
  normalizeFinancialDocumentItem,
} from '../_documentListEnrichers'
import { z } from 'zod'

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    id: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
    invoiceId: z.string().uuid().optional(),
    dateFrom: z.string().optional().refine((value) => !value || !Number.isNaN(new Date(value).getTime())),
    dateTo: z.string().optional().refine((value) => !value || !Number.isNaN(new Date(value).getTime())),
    totalGrossMin: z.coerce.number().optional(),
    totalGrossMax: z.coerce.number().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const rawBodySchema = z.object({}).passthrough()

type CreditMemoCommandResult = {
  id?: string | null
  creditMemoId?: string | null
}

const crud = makeCrudRoute({
  orm: {
    entity: SalesCreditMemo,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: E.sales.sales_credit_memo },
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['sales.credit_memos.view'] },
    POST: { requireAuth: true, requireFeatures: ['sales.credit_memos.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['sales.credit_memos.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['sales.credit_memos.manage'] },
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_credit_memo,
    fields: [
      'id',
      'order_id',
      'invoice_id',
      'credit_memo_number',
      'status_entry_id',
      'status',
      'reason',
      'issue_date',
      'currency_code',
      'subtotal_net_amount',
      'subtotal_gross_amount',
      'tax_total_amount',
      'grand_total_net_amount',
      'grand_total_gross_amount',
      'metadata',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      number: 'credit_memo_number',
      creditMemoNumber: 'credit_memo_number',
      status: 'status',
      reason: 'reason',
      issueDate: 'issue_date',
      grandTotalGrossAmount: 'grand_total_gross_amount',
      createdAt: 'created_at',
    },
    transformItem: (item: Record<string, unknown>) => normalizeFinancialDocumentItem(item, 'credit-memo'),
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.orderId) filters.order_id = { $eq: query.orderId }
      if (query.invoiceId) filters.invoice_id = { $eq: query.invoiceId }
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
          { credit_memo_number: { $ilike: term } },
          { status: { $ilike: term } },
          { reason: { $ilike: term } },
        ]
      }
      return filters
    },
  },
  hooks: {
    afterList: async (payload, ctx) => {
      await attachOrderContext(payload as { items?: unknown }, ctx as never)
      await attachCreditMemoLines(payload as { items?: unknown }, ctx as never)
    },
  },
  actions: {
    create: {
      commandId: 'sales.credit_memos.create',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }: { raw: unknown; ctx: CrudCtx }) => {
        const { translate } = await resolveTranslations()
        const { base, custom } = splitCustomFieldPayload(raw ?? {})
        const parsed = parseScopedCommandInput(
          creditMemoCreateSchema,
          Object.keys(custom).length ? { ...base, customFields: custom } : base,
          ctx,
          translate,
        )
        return parsed
      },
      response: ({ result }: { result: CreditMemoCommandResult | null | undefined }) => ({
        creditMemoId: result?.creditMemoId ?? result?.id ?? null,
      }),
      status: 201,
    },
    update: {
      commandId: 'sales.credit_memos.update',
      schema: rawBodySchema,
      mapInput: async ({ raw, ctx }: { raw: unknown; ctx: CrudCtx }) => {
        const { translate } = await resolveTranslations()
        const { base, custom } = splitCustomFieldPayload(raw ?? {})
        const parsed = parseScopedCommandInput(
          creditMemoUpdateSchema,
          Object.keys(custom).length ? { ...base, customFields: custom } : base,
          ctx,
          translate,
        )
        return parsed
      },
      response: ({ result }: { result: CreditMemoCommandResult | null | undefined }) => ({
        creditMemoId: result?.creditMemoId ?? result?.id ?? null,
      }),
    },
    delete: {
      commandId: 'sales.credit_memos.delete',
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

const creditMemoItemSchema = z.object({
  id: z.string().uuid(),
  creditMemoNumber: z.string().nullable(),
  status: z.string().nullable().optional(),
  statusEntryId: z.string().uuid().nullable().optional(),
  reason: z.string().nullable().optional(),
  issueDate: z.string().nullable().optional(),
  currencyCode: z.string().nullable(),
  orderId: z.string().uuid().nullable().optional(),
  invoiceId: z.string().uuid().nullable().optional(),
  order: z.object({ id: z.string().uuid(), orderNumber: z.string().nullable() }).nullable().optional(),
  customerEntityId: z.string().uuid().nullable().optional(),
  customerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  subtotalNetAmount: z.string().nullable().optional(),
  subtotalGrossAmount: z.string().nullable().optional(),
  taxTotalAmount: z.string().nullable().optional(),
  grandTotalGrossAmount: z.string().nullable().optional(),
  grandTotalNetAmount: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  lines: z.array(z.record(z.string(), z.unknown())).optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'CreditMemo',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(creditMemoItemSchema),
  create: { schema: creditMemoCreateSchema, description: 'Create a new credit memo' },
  update: { schema: creditMemoUpdateSchema, responseSchema: z.object({ creditMemoId: z.string().uuid() }), description: 'Update a credit memo' },
  del: { schema: defaultDeleteRequestSchema, responseSchema: z.object({ ok: z.boolean() }), description: 'Delete a credit memo' },
})
