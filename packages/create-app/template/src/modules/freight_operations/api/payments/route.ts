import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { FreightPayment, PAYMENT_METHODS, PAYMENT_STATUSES } from '../../data/entities'
import { recordPaymentSchema } from '../../data/validators'
import { FREIGHT_PAYMENT_ENTITY_ID } from '../../commands/entities'
import { executeFreightAction } from '../../lib/apiAction'

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  orderId: z.string().uuid().optional(),
  abstractId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
})

export const metadata = {
  path: '/freight_operations/payments',
  GET: { requireAuth: true, requireFeatures: ['freight.read'] },
  POST: { requireAuth: true, requireFeatures: ['freight.payments.record'] },
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()
    if (!auth?.tenantId) throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
    const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) throw new CrudHttpError(400, { error: translate('errors.organization_required', 'Organization context is required') })

    const url = new URL(req.url)
    const query = listSchema.parse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      orderId: url.searchParams.get('orderId') ?? undefined,
      abstractId: url.searchParams.get('abstractId') ?? undefined,
      customerId: url.searchParams.get('customerId') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      method: url.searchParams.get('method') ?? undefined,
    })

    const em = (container.resolve('em') as EntityManager).fork()
    const where: FilterQuery<FreightPayment> = {
      tenantId: auth.tenantId,
      organizationId,
      deletedAt: null,
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.abstractId ? { abstractId: query.abstractId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.method ? { method: query.method } : {}),
    }
    const [rows, total] = await Promise.all([
      em.find(FreightPayment, where, {
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
        orderBy: { receivedAt: 'desc', createdAt: 'desc' },
      }),
      em.count(FreightPayment, where),
    ])
    return NextResponse.json({
      items: rows.map((row) => ({
        id: row.id,
        organization_id: row.organizationId,
        tenant_id: row.tenantId,
        order_id: row.orderId ?? null,
        abstract_id: row.abstractId ?? null,
        customer_id: row.customerId,
        currency_code: row.currencyCode,
        amount: row.amount,
        method: row.method,
        reference: row.reference ?? null,
        received_at: row.receivedAt instanceof Date ? row.receivedAt.toISOString().slice(0, 10) : String(row.receivedAt),
        status: row.status,
        sales_payment_id: row.salesPaymentId ?? null,
        invoice_synced_at: row.invoiceSyncedAt instanceof Date ? row.invoiceSyncedAt.toISOString() : row.invoiceSyncedAt ?? null,
        voided_at: row.voidedAt instanceof Date ? row.voidedAt.toISOString() : row.voidedAt ?? null,
        void_reason: row.voidReason ?? null,
        notes: row.notes ?? null,
        created_at: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
        updated_at: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
        updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(Math.ceil(total / query.pageSize), 1),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid query', details: err.issues }, { status: 400 })
    }
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('freight_operations.errors.payments_load_failed', 'Unable to load payments.') }, { status: 500 })
  }
}

export async function POST(req: Request) {
  return executeFreightAction<{
    paymentId: string
    salesPaymentId: string
    paidTotalAmount: string
    outstandingAmount: string | null
    invoiceSynced: boolean
  }>(req, {
    parse: (raw) => recordPaymentSchema.parse(raw),
    resourceKind: FREIGHT_PAYMENT_ENTITY_ID,
    resourceId: (input) => String(input.orderId ?? input.abstractId ?? ''),
    commandId: 'freight_operations.payments.record',
    errorMessageKey: 'payment_record_failed',
    errorFallback: 'Unable to record the payment.',
    toResponse: (result) => ({
      paymentId: result.paymentId,
      salesPaymentId: result.salesPaymentId,
      paidTotalAmount: result.paidTotalAmount,
      outstandingAmount: result.outstandingAmount,
      invoiceSynced: result.invoiceSynced,
    }),
  })
}

const paymentRowSchema = z.object({
  id: z.string().uuid(),
  order_id: z.string().uuid().nullable(),
  abstract_id: z.string().uuid().nullable(),
  customer_id: z.string().uuid(),
  currency_code: z.string(),
  amount: z.string(),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().nullable(),
  received_at: z.string(),
  status: z.enum(PAYMENT_STATUSES),
  invoice_synced_at: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
})

const getDoc: OpenApiMethodDoc = {
  summary: 'List freight payments',
  tags: ['Freight Operations'],
  responses: [{
    status: 200,
    description: 'Paged payments for the authenticated organization',
    schema: z.object({ items: z.array(paymentRowSchema), total: z.number(), page: z.number(), pageSize: z.number(), totalPages: z.number() }),
  }],
}

const postDoc: OpenApiMethodDoc = {
  summary: 'Record a freight payment',
  tags: ['Freight Operations'],
  requestBody: { schema: recordPaymentSchema },
  responses: [{
    status: 200,
    description: 'Payment recorded and the invoice ledger synced',
    schema: z.object({
      ok: z.boolean(),
      paymentId: z.string().uuid(),
      salesPaymentId: z.string().uuid(),
      paidTotalAmount: z.string(),
      outstandingAmount: z.string().nullable(),
      invoiceSynced: z.boolean(),
    }),
  }],
  errors: [
    { status: 400, description: 'Invalid request body' },
    { status: 409, description: 'The target document is not invoiced' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Freight Operations',
  summary: 'Freight payments ledger',
  description: 'Bank-transfer payments recorded against invoiced freight orders and abstracts, with the sales invoice totals kept in sync.',
  methods: { GET: getDoc, POST: postDoc },
}
