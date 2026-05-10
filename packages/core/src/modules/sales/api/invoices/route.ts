import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { SalesInvoice, SalesInvoiceLine, SalesOrder } from '../../data/entities'
import { E } from '#generated/entities.ids.generated'
import { invoiceCreateSchema, invoiceUpdateSchema } from '../../data/validators'
import { createSalesCrudOpenApi, createPagedListResponseSchema, defaultDeleteRequestSchema } from '../openapi'
import { parseScopedCommandInput, resolveCrudRecordId } from '../utils'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { wrap } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'

function readOrderId(item: Record<string, unknown>): string | null {
  const direct = item.order_id ?? (item as any).orderId
  if (typeof direct === 'string' && direct.length > 0) return direct
  const relation = (item as any).order
  if (relation && typeof relation === 'object') {
    const id = (relation as { id?: unknown }).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  if (typeof relation === 'string' && relation.length > 0) return relation
  return null
}

async function attachOrderContext(payload: any, ctx: CrudCtx) {
  const items = Array.isArray(payload?.items) ? (payload.items as unknown[]) : []
  if (!items.length) return
  const plainItems: Array<Record<string, unknown>> = items.map((item) => {
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
  })
  payload.items = plainItems
  const orderIds = Array.from(
    new Set(plainItems.map((item) => readOrderId(item)).filter((id): id is string => !!id)),
  )
  const orderById = new Map<string, SalesOrder>()
  if (orderIds.length) {
    const em = ctx?.container?.resolve?.('em') as EntityManager | undefined
    if (em) {
      const tenantId = ctx?.auth?.tenantId ?? null
      const organizationId = ctx?.selectedOrganizationId ?? ctx?.auth?.orgId ?? null
      const where: Record<string, unknown> = { id: { $in: orderIds }, deletedAt: null }
      if (tenantId) where.tenantId = tenantId
      if (organizationId) where.organizationId = organizationId
      const orders = await em.find(SalesOrder, where as any)
      for (const order of orders) orderById.set(order.id, order)
    }
  }
  for (const item of plainItems) {
    const orderId = readOrderId(item)
    const order = orderId ? orderById.get(orderId) ?? null : null
    item.orderId = orderId
    item.order = order ? { id: order.id, orderNumber: order.orderNumber } : null
    item.customerEntityId = order?.customerEntityId ?? null
    item.customerSnapshot = order?.customerSnapshot ?? null
  }
}

function readInvoiceId(item: Record<string, unknown>): string | null {
  const id = item.id
  return typeof id === 'string' && id.length > 0 ? id : null
}

async function attachInvoiceLines(payload: any, ctx: CrudCtx) {
  const items = Array.isArray(payload?.items) ? (payload.items as Array<Record<string, unknown>>) : []
  if (!items.length) return
  const invoiceIds = Array.from(new Set(items.map((item) => readInvoiceId(item)).filter((id): id is string => !!id)))
  if (!invoiceIds.length) return
  const em = ctx?.container?.resolve?.('em') as EntityManager | undefined
  if (!em) return
  const tenantId = ctx?.auth?.tenantId ?? null
  const organizationId = ctx?.selectedOrganizationId ?? ctx?.auth?.orgId ?? null
  const where: Record<string, unknown> = { invoice: { $in: invoiceIds } }
  if (tenantId) where.tenantId = tenantId
  if (organizationId) where.organizationId = organizationId
  const lines = await em.find(SalesInvoiceLine, where as any, { orderBy: { lineNumber: 'asc' } })
  const linesByInvoice = new Map<string, Array<Record<string, unknown>>>()
  for (const line of lines) {
    const wrapped = wrap(line, true)
    const json = (wrapped && typeof wrapped.toJSON === 'function' ? wrapped.toJSON() : { ...line }) as Record<string, unknown>
    const invoiceRef = (json.invoice ?? json.invoice_id) as unknown
    const invoiceId =
      typeof invoiceRef === 'string'
        ? invoiceRef
        : invoiceRef && typeof invoiceRef === 'object'
          ? ((invoiceRef as { id?: unknown }).id as string | undefined) ?? null
          : null
    if (!invoiceId) continue
    const bucket = linesByInvoice.get(invoiceId) ?? []
    bucket.push(json)
    linesByInvoice.set(invoiceId, bucket)
  }
  for (const item of items) {
    const invoiceId = readInvoiceId(item)
    item.lines = invoiceId ? linesByInvoice.get(invoiceId) ?? [] : []
  }
}

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
      if (query.orderId) filters.order = query.orderId
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
  hooks: {
    afterList: async (payload, ctx) => {
      await attachOrderContext(payload, ctx)
      await attachInvoiceLines(payload, ctx)
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

const invoiceLineSchema = z.object({
  id: z.string().uuid(),
  lineNumber: z.number(),
  name: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  kind: z.string().optional(),
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
  orderId: z.string().uuid().nullable().optional(),
  order: z
    .object({
      id: z.string().uuid(),
      orderNumber: z.string(),
    })
    .nullable()
    .optional(),
  customerEntityId: z.string().uuid().nullable().optional(),
  customerSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  lines: z.array(invoiceLineSchema).optional(),
})

export const openApi = createSalesCrudOpenApi({
  resourceName: 'Invoice',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(invoiceItemSchema),
  create: { schema: invoiceCreateSchema, description: 'Create a new invoice' },
  update: { schema: invoiceUpdateSchema, responseSchema: z.object({ invoiceId: z.string().uuid() }), description: 'Update an invoice' },
  del: { schema: defaultDeleteRequestSchema, responseSchema: z.object({ ok: z.boolean() }), description: 'Delete an invoice' },
})
