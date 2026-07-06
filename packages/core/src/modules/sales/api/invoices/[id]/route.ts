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
import { SalesInvoice, SalesInvoiceLine, SalesOrder } from '../../../data/entities'

const paramsSchema = z.object({ id: z.string().uuid() })

const lineSchema = z.object({
  id: z.string().uuid(),
  lineNumber: z.number().int().nonnegative(),
  kind: z.string(),
  name: z.string().nullable(),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  quantity: z.string(),
  quantityUnit: z.string().nullable(),
  currencyCode: z.string(),
  unitPriceNet: z.string(),
  unitPriceGross: z.string(),
  discountAmount: z.string(),
  discountPercent: z.string(),
  taxRate: z.string(),
  taxAmount: z.string(),
  totalNetAmount: z.string(),
  totalGrossAmount: z.string(),
  orderLineId: z.string().uuid().nullable(),
})

const detailSchema = z.object({
  id: z.string().uuid(),
  invoiceNumber: z.string(),
  status: z.string().nullable(),
  statusEntryId: z.string().uuid().nullable(),
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  currencyCode: z.string(),
  subtotalNetAmount: z.string(),
  subtotalGrossAmount: z.string(),
  discountTotalAmount: z.string(),
  taxTotalAmount: z.string(),
  grandTotalNetAmount: z.string(),
  grandTotalGrossAmount: z.string(),
  paidTotalAmount: z.string(),
  outstandingAmount: z.string(),
  orderId: z.string().uuid().nullable(),
  order: z.object({ id: z.string().uuid(), orderNumber: z.string().nullable() }).nullable(),
  customerEntityId: z.string().uuid().nullable(),
  customerSnapshot: z.record(z.string(), z.unknown()).nullable(),
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
    const invoice = await findOneWithDecryption(em, SalesInvoice, {
      id,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
    }, {}, scope)
    if (!invoice) {
      throw new CrudHttpError(404, { error: translate('sales.invoices.errors.notFound', 'Invoice not found') })
    }

    const lineRecords = await findWithDecryption(
      em,
      SalesInvoiceLine,
      { invoice, organizationId: scope.organizationId, tenantId: scope.tenantId },
      { orderBy: { lineNumber: 'asc' } },
      scope,
    )

    const orderId = invoice.order?.id ?? null
    const order = orderId
      ? await findOneWithDecryption(em, SalesOrder, {
          id: orderId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        }, {}, scope)
      : null

    return NextResponse.json({
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status ?? null,
      statusEntryId: invoice.statusEntryId ?? null,
      issueDate: invoice.issueDate ? invoice.issueDate.toISOString() : null,
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
      currencyCode: invoice.currencyCode,
      subtotalNetAmount: invoice.subtotalNetAmount,
      subtotalGrossAmount: invoice.subtotalGrossAmount,
      discountTotalAmount: invoice.discountTotalAmount,
      taxTotalAmount: invoice.taxTotalAmount,
      grandTotalNetAmount: invoice.grandTotalNetAmount,
      grandTotalGrossAmount: invoice.grandTotalGrossAmount,
      paidTotalAmount: invoice.paidTotalAmount,
      outstandingAmount: invoice.outstandingAmount,
      orderId,
      order: order ? { id: order.id, orderNumber: order.orderNumber ?? null } : null,
      customerEntityId: order?.customerEntityId ?? null,
      customerSnapshot: order?.customerSnapshot ?? null,
      metadata: invoice.metadata ?? null,
      customFieldSetId: invoice.customFieldSetId ?? null,
      organizationId: invoice.organizationId,
      tenantId: invoice.tenantId,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
      lines: lineRecords.map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        kind: line.kind,
        name: line.name ?? null,
        sku: line.sku ?? null,
        description: line.description ?? null,
        quantity: line.quantity,
        quantityUnit: line.quantityUnit ?? null,
        currencyCode: line.currencyCode,
        unitPriceNet: line.unitPriceNet,
        unitPriceGross: line.unitPriceGross,
        discountAmount: line.discountAmount,
        discountPercent: line.discountPercent,
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
    console.error('sales.invoices.get failed', err)
    const { translate } = await resolveTranslations()
    return NextResponse.json(
      { error: translate('sales.invoices.errors.loadFailed', 'Failed to load invoice') },
      { status: 400 },
    )
  }
}

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.invoices.view'] },
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Fetch invoice detail',
  methods: {
    GET: {
      summary: 'Fetch invoice by id',
      description: 'Returns a single invoice with line items, scoped to the current organization.',
      responses: [
        { status: 200, description: 'Invoice detail with lines', schema: detailSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid invoice id', schema: errorResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorResponseSchema },
        { status: 404, description: 'Invoice not found', schema: errorResponseSchema },
      ],
    },
  },
}
