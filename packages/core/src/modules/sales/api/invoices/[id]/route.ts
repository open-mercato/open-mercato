import { z } from 'zod'
import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesInvoice, SalesInvoiceLine } from '../../../data/entities'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sales.invoices.manage'] },
}

const paramsSchema = z.object({ id: z.string().uuid() })

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function relationId(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id
  }
  return null
}

export async function GET(req: Request, ctx: { params: { id: string } }) {
  try {
    const { id } = paramsSchema.parse(ctx.params ?? {})
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    const { translate } = await resolveTranslations()

    if (!auth || !auth.tenantId) {
      throw new CrudHttpError(401, { error: translate('sales.documents.errors.unauthorized', 'Unauthorized') })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const organizationId = scope?.selectedId ?? auth.orgId ?? null
    if (!organizationId) {
      throw new CrudHttpError(400, {
        error: translate('sales.documents.errors.organization_required', 'Organization context is required'),
      })
    }

    const em = (container.resolve('em') as EntityManager).fork()
    const header = await findOneWithDecryption(
      em,
      SalesInvoice,
      { id, deletedAt: null, tenantId: auth.tenantId, organizationId },
      { populate: ['order'] },
      { tenantId: auth.tenantId, organizationId },
    )
    if (!header) {
      throw new CrudHttpError(404, { error: translate('sales.invoices.notFound', 'Invoice not found.') })
    }

    const lines = await findWithDecryption(
      em,
      SalesInvoiceLine,
      { invoice: header.id },
      { populate: ['orderLine'], orderBy: { lineNumber: 'asc' } },
      { tenantId: auth.tenantId, organizationId },
    )

    return NextResponse.json({
      invoice: {
        id: header.id,
        orderId: relationId(header.order),
        invoiceNumber: header.invoiceNumber,
        statusEntryId: header.statusEntryId ?? null,
        status: header.status ?? null,
        issueDate: toIso(header.issueDate),
        dueDate: toIso(header.dueDate),
        currencyCode: header.currencyCode,
        subtotalNetAmount: String(header.subtotalNetAmount ?? '0'),
        subtotalGrossAmount: String(header.subtotalGrossAmount ?? '0'),
        discountTotalAmount: String(header.discountTotalAmount ?? '0'),
        taxTotalAmount: String(header.taxTotalAmount ?? '0'),
        grandTotalNetAmount: String(header.grandTotalNetAmount ?? '0'),
        grandTotalGrossAmount: String(header.grandTotalGrossAmount ?? '0'),
        paidTotalAmount: String(header.paidTotalAmount ?? '0'),
        outstandingAmount: String(header.outstandingAmount ?? '0'),
        metadata: header.metadata ?? null,
        createdAt: toIso(header.createdAt),
        updatedAt: toIso(header.updatedAt),
      },
      lines: lines.map((line) => ({
        id: line.id,
        orderLineId: relationId(line.orderLine),
        lineNumber: line.lineNumber,
        kind: line.kind ?? 'product',
        serviceId: line.serviceId ?? null,
        name: line.name ?? null,
        sku: line.sku ?? null,
        description: line.description ?? null,
        quantity: String(line.quantity ?? '0'),
        quantityUnit: line.quantityUnit ?? null,
        normalizedQuantity: String(line.normalizedQuantity ?? '0'),
        normalizedUnit: line.normalizedUnit ?? null,
        uomSnapshot: line.uomSnapshot ?? null,
        currencyCode: line.currencyCode,
        unitPriceNet: String(line.unitPriceNet ?? '0'),
        unitPriceGross: String(line.unitPriceGross ?? '0'),
        discountAmount: String(line.discountAmount ?? '0'),
        discountPercent: String(line.discountPercent ?? '0'),
        taxRate: String(line.taxRate ?? '0'),
        taxAmount: String(line.taxAmount ?? '0'),
        totalNetAmount: String(line.totalNetAmount ?? '0'),
        totalGrossAmount: String(line.totalGrossAmount ?? '0'),
        metadata: line.metadata ?? null,
      })),
    })
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    console.error('sales.invoices.get failed', err)
    const { translate } = await resolveTranslations()
    return NextResponse.json({ error: translate('sales.invoices.error', 'Failed to load invoice.') }, { status: 400 })
  }
}

const invoiceLineSchema = z.object({
  id: z.string().uuid(),
  orderLineId: z.string().uuid().nullable(),
  lineNumber: z.number(),
  kind: z.string(),
  serviceId: z.string().uuid().nullable(),
  name: z.string().nullable(),
  sku: z.string().nullable(),
  description: z.string().nullable(),
  quantity: z.string(),
  quantityUnit: z.string().nullable(),
  normalizedQuantity: z.string(),
  normalizedUnit: z.string().nullable(),
  uomSnapshot: z.record(z.string(), z.unknown()).nullable().optional(),
  currencyCode: z.string(),
  unitPriceNet: z.string(),
  unitPriceGross: z.string(),
  discountAmount: z.string(),
  discountPercent: z.string(),
  taxRate: z.string(),
  taxAmount: z.string(),
  totalNetAmount: z.string(),
  totalGrossAmount: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Sales',
  summary: 'Get an invoice',
  pathParams: paramsSchema,
  methods: {
    GET: {
      summary: 'Get invoice details',
      responses: [
        {
          status: 200,
          description: 'Invoice details',
          schema: z.object({
            invoice: z.object({
              id: z.string().uuid(),
              orderId: z.string().uuid().nullable(),
              invoiceNumber: z.string(),
              statusEntryId: z.string().uuid().nullable(),
              status: z.string().nullable(),
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
              metadata: z.record(z.string(), z.unknown()).nullable().optional(),
              createdAt: z.string().nullable(),
              updatedAt: z.string().nullable(),
            }),
            lines: z.array(invoiceLineSchema),
          }),
        },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 404, description: 'Not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
