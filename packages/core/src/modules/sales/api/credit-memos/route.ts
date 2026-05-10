import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { SalesCreditMemo, SalesCreditMemoLine } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { creditMemoCreateSchema, creditMemoUpdateSchema } from '../../data/validators'
import { createSalesCrudOpenApi, createPagedListResponseSchema, defaultDeleteRequestSchema } from '../openapi'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { wrap } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'

function readCreditMemoId(item: Record<string, unknown>): string | null {
  const id = item.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

function toPlainItem(item: unknown): Record<string, unknown> {
  if (item && typeof item === 'object') {
    try {
      const wrapped = wrap(item as object, true)
      if (wrapped && typeof wrapped.toJSON === 'function') {
        return wrapped.toJSON() as Record<string, unknown>
      }
    } catch {
      // not a managed entity — fall through
    }
    return { ...(item as Record<string, unknown>) }
  }
  return {}
}

async function attachCreditMemoLines(payload: any, ctx: CrudCtx) {
  const items = Array.isArray(payload?.items) ? (payload.items as unknown[]) : []
  if (!items.length) return
  const plainItems = items.map(toPlainItem)
  payload.items = plainItems
  const memoIds = Array.from(new Set(plainItems.map(readCreditMemoId).filter((id): id is string => !!id)))
  if (!memoIds.length) {
    for (const item of plainItems) item.lines = []
    return
  }
  const em = ctx?.container?.resolve?.('em') as EntityManager | undefined
  if (!em) return
  const tenantId = ctx?.auth?.tenantId ?? null
  const organizationId = ctx?.selectedOrganizationId ?? ctx?.auth?.orgId ?? null
  const where: Record<string, unknown> = { creditMemo: { $in: memoIds } }
  if (tenantId) where.tenantId = tenantId
  if (organizationId) where.organizationId = organizationId
  const lines = await em.find(SalesCreditMemoLine, where as any, { orderBy: { lineNumber: 'asc' } })
  const linesByMemo = new Map<string, Array<Record<string, unknown>>>()
  for (const line of lines) {
    const wrapped = wrap(line, true)
    const json = (wrapped && typeof wrapped.toJSON === 'function' ? wrapped.toJSON() : { ...line }) as Record<string, unknown>
    const memoRef = (json.creditMemo ?? json.credit_memo_id) as unknown
    const memoId =
      typeof memoRef === 'string'
        ? memoRef
        : memoRef && typeof memoRef === 'object'
          ? ((memoRef as { id?: unknown }).id as string | undefined) ?? null
          : null
    if (!memoId) continue
    const bucket = linesByMemo.get(memoId) ?? []
    bucket.push(json)
    linesByMemo.set(memoId, bucket)
  }
  for (const item of plainItems) {
    const memoId = readCreditMemoId(item)
    item.lines = memoId ? linesByMemo.get(memoId) ?? [] : []
  }
}

const listSchema = z
  .object({
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    search: z.string().optional(),
    id: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
    invoiceId: z.string().uuid().optional(),
    sortField: z.string().optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

const rawBodySchema = z.object({}).passthrough()

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
    GET: { requireAuth: true, requireFeatures: ['sales.credit_memos.manage'] },
    POST: { requireAuth: true, requireFeatures: ['sales.credit_memos.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['sales.credit_memos.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['sales.credit_memos.manage'] },
  },
  list: {
    schema: listSchema,
    entityId: E.sales.sales_credit_memo,
    sortFieldMap: {
      creditMemoNumber: 'credit_memo_number',
      status: 'status',
      reason: 'reason',
      issueDate: 'issue_date',
      grandTotalGrossAmount: 'grand_total_gross_amount',
      createdAt: 'created_at',
    },
    buildFilters: async (query) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = query.id
      if (query.orderId) filters.orderId = query.orderId
      if (query.invoiceId) filters.invoiceId = query.invoiceId
      if (query.search) {
        const term = `%${escapeLikePattern(query.search.trim())}%`
        filters.$or = [
          { creditMemoNumber: { $ilike: term } },
          { status: { $ilike: term } },
          { reason: { $ilike: term } },
        ]
      }
      return filters
    },
  },
  hooks: {
    afterList: attachCreditMemoLines,
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
      response: ({ result }: { result: any }) => ({ creditMemoId: result?.creditMemoId ?? result?.id ?? null }),
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
      response: ({ result }: { result: any }) => ({ creditMemoId: result?.creditMemoId ?? result?.id ?? null }),
    },
    delete: {
      commandId: 'sales.credit_memos.delete',
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

const creditMemoLineSchema = z.object({
  id: z.string().uuid(),
  lineNumber: z.number(),
  name: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  quantity: z.string(),
  quantityUnit: z.string().nullable().optional(),
  currencyCode: z.string(),
  unitPriceNet: z.string(),
  unitPriceGross: z.string(),
  taxRate: z.string(),
  taxAmount: z.string(),
  totalNetAmount: z.string(),
  totalGrossAmount: z.string(),
})

const creditMemoItemSchema = z.object({
  id: z.string().uuid(),
  creditMemoNumber: z.string(),
  status: z.string().nullable().optional(),
  reason: z.string().nullable().optional(),
  issueDate: z.string().nullable().optional(),
  currencyCode: z.string(),
  grandTotalGrossAmount: z.string().optional(),
  grandTotalNetAmount: z.string().optional(),
  taxTotalAmount: z.string().optional(),
  lines: z.array(creditMemoLineSchema).optional(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'CreditMemo',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(creditMemoItemSchema),
  create: { schema: creditMemoCreateSchema, description: 'Create a new credit memo' },
  update: { schema: creditMemoUpdateSchema, responseSchema: z.object({ creditMemoId: z.string().uuid() }), description: 'Update a credit memo' },
  del: { schema: defaultDeleteRequestSchema, responseSchema: z.object({ ok: z.boolean() }), description: 'Delete a credit memo' },
})
