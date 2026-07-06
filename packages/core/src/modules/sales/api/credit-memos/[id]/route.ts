import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesCreditMemo, SalesCreditMemoLine, SalesOrder } from '../../../data/entities'

const paramsSchema = z.object({ id: z.string().uuid() })

const lineSchema = z.object({
  id: z.string().uuid(),
  lineNumber: z.number().int().nonnegative(),
  name: z.string().nullable(),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  quantity: z.string(),
  quantityUnit: z.string().nullable(),
  currencyCode: z.string(),
  unitPriceNet: z.string(),
  unitPriceGross: z.string(),
  taxRate: z.string(),
  taxAmount: z.string(),
  totalNetAmount: z.string(),
  totalGrossAmount: z.string(),
  orderLineId: z.string().uuid().nullable(),
})

const detailSchema = z.object({
  id: z.string().uuid(),
  creditMemoNumber: z.string(),
  status: z.string().nullable(),
  statusEntryId: z.string().uuid().nullable(),
  reason: z.string().nullable(),
  issueDate: z.string().nullable(),
  currencyCode: z.string(),
  subtotalNetAmount: z.string(),
  subtotalGrossAmount: z.string(),
  taxTotalAmount: z.string(),
  grandTotalNetAmount: z.string(),
  grandTotalGrossAmount: z.string(),
  orderId: z.string().uuid().nullable(),
  order: z.object({ id: z.string().uuid(), orderNumber: z.string().nullable() }).nullable(),
  customerEntityId: z.string().uuid().nullable(),
  customerSnapshot: z.record(z.string(), z.unknown()).nullable(),
  invoiceId: z.string().uuid().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  customFieldSetId: z.string().uuid().nullable(),
  organizationId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lines: z.array(lineSchema),
})

const errorResponseSchema = z.object({ error: z.string() })

export async function GET(req: Request, ctx: { params?: { id?: string } }) {
  try {
    const { id } = paramsSchema.parse(ctx.params ?? {})
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, { error: translate('sales.documents.errors.unauthorized', 'Unauthorized') })
    }

    const orgScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = orgScope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('sales.documents.errors.organization_required', 'Organization context is required'),
      })
    }
    const scope = { tenantId: auth.tenantId, organizationId }

    const em = (container.resolve('em') as EntityManager).fork()
    const creditMemo = await findOneWithDecryption(em, SalesCreditMemo, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, {}, scope)
    if (!creditMemo) {
      throw new CrudHttpError(404, { error: translate('sales.credit_memos.errors.notFound', 'Credit memo not found') })
    }

    const lineRecords = await findWithDecryption(
      em,
      SalesCreditMemoLine,
      { creditMemo, organizationId: scope.organizationId, tenantId: scope.tenantId },
      { orderBy: { lineNumber: 'asc' } },
      scope,
    )

    const orderId = creditMemo.order?.id ?? null
    const order = orderId
      ? await findOneWithDecryption(em, SalesOrder, {
          id: orderId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        }, {}, scope)
      : null

    return NextResponse.json({
      id: creditMemo.id,
      creditMemoNumber: creditMemo.creditMemoNumber,
      status: creditMemo.status ?? null,
      statusEntryId: creditMemo.statusEntryId ?? null,
      reason: creditMemo.reason ?? null,
      issueDate: creditMemo.issueDate ? creditMemo.issueDate.toISOString() : null,
      currencyCode: creditMemo.currencyCode,
      subtotalNetAmount: creditMemo.subtotalNetAmount,
      subtotalGrossAmount: creditMemo.subtotalGrossAmount,
      taxTotalAmount: creditMemo.taxTotalAmount,
      grandTotalNetAmount: creditMemo.grandTotalNetAmount,
      grandTotalGrossAmount: creditMemo.grandTotalGrossAmount,
      orderId,
      order: order ? { id: order.id, orderNumber: order.orderNumber ?? null } : null,
      customerEntityId: order?.customerEntityId ?? null,
      customerSnapshot: order?.customerSnapshot ?? null,
      invoiceId: creditMemo.invoice?.id ?? null,
      metadata: creditMemo.metadata ?? null,
      customFieldSetId: creditMemo.customFieldSetId ?? null,
      organizationId: creditMemo.organizationId,
      tenantId: creditMemo.tenantId,
      createdAt: creditMemo.createdAt.toISOString(),
      updatedAt: creditMemo.updatedAt.toISOString(),
      lines: lineRecords.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        name: line.name ?? null,
        sku: line.sku ?? null,
        description: line.description ?? null,
        quantity: line.quantity,
        quantityUnit: line.quantityUnit ?? null,
        currencyCode: line.currencyCode,
        unitPriceNet: line.unitPriceNet,
        unitPriceGross: line.unitPriceGross,
        taxRate: line.taxRate,
        taxAmount: line.taxAmount,
        totalNetAmount: line.totalNetAmount,
        totalGrossAmount: line.totalGrossAmount,
        orderLineId: line.orderLine?.id ?? null,
      })),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('sales.credit_memos.get failed', err)
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('sales.credit_memos.errors.loadFailed', 'Failed to load credit memo') },
      { status: 400 },
    )
  }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.credit_memos.view'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Fetch credit memo detail',
  methods: {
    GET: {
      summary: 'Fetch credit memo by id',
      description: 'Returns a single credit memo with line items, scoped to the current organization.',
      responses: [
        { status: 200, description: 'Credit memo detail with lines', schema: detailSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid credit memo id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Credit memo not found', schema: errorResponseSchema },
      ],
    },
  },
}
