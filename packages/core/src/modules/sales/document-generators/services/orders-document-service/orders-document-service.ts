import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  BaseDocumentService,
  buildDocumentFilename,
  buildLabels,
  firstText,
  toIso,
  toNumber,
  toSnapshotRecord,
  toText,
} from '@open-mercato/shared/modules/document-generators'
import type {
  DocumentDataInput,
  DocumentFetchContext,
  TemplateNormalizationInput,
} from '@open-mercato/shared/modules/document-generators'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { SalesChannel, SalesOrder, SalesOrderLine } from '../../../data/entities'
import {
  ORDER_INVOICE_LABEL_KEYS,
  type OrderInvoiceData,
  type OrderInvoiceLabels,
  type OrderInvoiceLine,
} from '../../templates/orders/order-invoice/types'
import { resolveClientAddress, resolveClientName } from '../../utils/client'
import { isDraftDocumentStatus } from '../../utils/status'
import { reconcileDocumentTotals } from '../../utils/totals'

const orderRequestSchema = z.object({ id: z.string().uuid() })

export interface OrderDocumentOrderRecord {
  id: string
  orderNumber: string
  status?: string | null
  currencyCode: string
  customerSnapshot: unknown
  billingAddressSnapshot: unknown
  placedAt: string | null
  createdAt: string
  dueAt: string | null
  comments: string | null
  subtotalNetAmount: string
  discountTotalAmount: string
  shippingNetAmount: string
  surchargeTotalAmount: string
  taxTotalAmount: string
  grandTotalGrossAmount: string
  paidTotalAmount: string
  outstandingAmount: string
}

export interface OrderDocumentLineRecord {
  lineNumber: number
  name: string | null
  description: string | null
  quantity: string
  currencyCode: string
  unitPriceNet: string
  unitPriceGross: string
  totalNetAmount: string
  totalGrossAmount: string
}

export interface OrderDocumentChannelRecord {
  name: string
  contactEmail: string | null
  contactPhone: string | null
}

export interface OrderDocumentSource {
  order: OrderDocumentOrderRecord
  lines: OrderDocumentLineRecord[]
  channel: OrderDocumentChannelRecord | null
}

const LABEL_DEFAULTS: OrderInvoiceLabels = {
  title: 'Invoice',
  number: 'Order number',
  date: 'Date',
  dueDate: 'Due date',
  client: 'Client',
  seller: 'Seller',
  item: 'Item',
  quantity: 'Quantity',
  unitPrice: 'Unit price',
  total: 'Total',
  subtotal: 'Subtotal',
  adjustments: 'Discounts and adjustments',
  shipping: 'Shipping',
  surcharge: 'Surcharge',
  tax: 'Tax',
  grandTotal: 'Total due',
  paid: 'Paid',
  outstanding: 'Outstanding',
  notes: 'Notes',
  draftWatermark: 'DRAFT',
}

function requireSource(data: unknown): OrderDocumentSource {
  const source = data as Partial<OrderDocumentSource> | null
  if (!source || typeof source !== 'object' || !source.order || !Array.isArray(source.lines)) {
    throw new CrudHttpError(400, { error: 'invalid_request' })
  }
  return source as OrderDocumentSource
}

export class OrdersDocumentService extends BaseDocumentService {
  readonly id = 'orders'
  readonly label = 'Orders'
  readonly module = 'sales'
  readonly resourceKind = 'sales.order'

  constructor() {
    super()
    this.registerTemplate({
      id: 'sales.order-invoice',
      label: 'sales.documents.templates.invoice.label',
      description: 'sales.documents.templates.invoice.description',
      documentType: 'invoice',
      format: 'pdf',
      tags: ['sales', 'order'],
      requiredFeatures: ['sales.orders.view'],
      filename: ({ data }) => buildDocumentFilename(data, 'invoice', 'pdf'),
      load: async () => ({
        type: 'react-pdf',
        component: (await import('../../templates/orders/order-invoice/pdf/OrderInvoicePdf')).default,
      }),
    })
    this.registerTemplate({
      id: 'sales.order-invoice-markdown',
      label: 'sales.documents.templates.invoiceMarkdown.label',
      description: 'sales.documents.templates.invoiceMarkdown.description',
      documentType: 'invoice',
      format: 'md',
      tags: ['sales', 'order', 'markdown'],
      requiredFeatures: ['sales.orders.view'],
      filename: ({ data }) => buildDocumentFilename(data, 'invoice', 'md'),
      load: async () => ({
        type: 'markdown',
        render: (await import('../../templates/orders/order-invoice/markdown/order-invoice-markdown')).render,
      }),
    })
  }

  override async fetchData(
    { data }: { data: unknown },
    { container, auth }: DocumentFetchContext,
  ): Promise<OrderDocumentSource> {
    const parsed = orderRequestSchema.safeParse(data)
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'invalid_request', details: parsed.error.flatten() })
    }
    const tenantId = auth?.tenantId
    const organizationId = auth?.orgId
    if (!tenantId || !organizationId) {
      throw new CrudHttpError(403, { error: 'organization_scope_required' })
    }
    const scope = { tenantId, organizationId }
    const em = (container.resolve('em') as EntityManager).fork()
    const order = await findOneWithDecryption(
      em,
      SalesOrder,
      { id: parsed.data.id, ...scope, deletedAt: null },
      {},
      scope,
    )
    if (!order) throw new CrudHttpError(404, { error: 'not_found' })
    const lines = await findWithDecryption(
      em,
      SalesOrderLine,
      { order: order.id, ...scope, deletedAt: null },
      { orderBy: { lineNumber: 'asc' } },
      scope,
    )
    const channel = order.channelId
      ? await findOneWithDecryption(em, SalesChannel, { id: order.channelId, ...scope, deletedAt: null }, {}, scope)
      : null
    return {
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status ?? null,
        currencyCode: order.currencyCode,
        customerSnapshot: order.customerSnapshot ?? null,
        billingAddressSnapshot: order.billingAddressSnapshot ?? null,
        placedAt: toIso(order.placedAt),
        createdAt: toIso(order.createdAt) ?? new Date(0).toISOString(),
        dueAt: toIso(order.dueAt),
        comments: order.comments ?? null,
        subtotalNetAmount: order.subtotalNetAmount,
        discountTotalAmount: order.discountTotalAmount,
        shippingNetAmount: order.shippingNetAmount,
        surchargeTotalAmount: order.surchargeTotalAmount,
        taxTotalAmount: order.taxTotalAmount,
        grandTotalGrossAmount: order.grandTotalGrossAmount,
        paidTotalAmount: order.paidTotalAmount,
        outstandingAmount: order.outstandingAmount,
      },
      lines: lines.map((line) => ({
        lineNumber: line.lineNumber,
        name: line.name ?? null,
        description: line.description ?? null,
        quantity: line.quantity,
        currencyCode: line.currencyCode,
        unitPriceNet: line.unitPriceNet,
        unitPriceGross: line.unitPriceGross,
        totalNetAmount: line.totalNetAmount,
        totalGrossAmount: line.totalGrossAmount,
      })),
      channel: channel
        ? {
            name: channel.name,
            contactEmail: channel.contactEmail ?? null,
            contactPhone: channel.contactPhone ?? null,
          }
        : null,
    }
  }

  toTemplateData({ data, locale, translate }: TemplateNormalizationInput): OrderInvoiceData & Record<string, unknown> {
    const { order, lines, channel } = requireSource(data)
    const customerSnapshot = toSnapshotRecord(order.customerSnapshot)
    const billingSnapshot = toSnapshotRecord(order.billingAddressSnapshot)
    const customer = toSnapshotRecord(customerSnapshot?.customer)
    const contact = toSnapshotRecord(customerSnapshot?.contact)
    const companyProfile = toSnapshotRecord(customer?.companyProfile)
    const currency = order.currencyCode
    const normalizedLines: OrderInvoiceLine[] = lines.map((line) => ({
      title: toText(line.name) ?? '',
      description: toText(line.description),
      quantity: toNumber(line.quantity),
      unitPrice: toNumber(line.unitPriceNet),
      total: toNumber(line.totalNetAmount),
      currency: line.currencyCode || currency,
    }))
    const sellerName = toText(channel?.name)
    return {
      locale,
      isDraft: isDraftDocumentStatus(order.status),
      labels: buildLabels(ORDER_INVOICE_LABEL_KEYS, LABEL_DEFAULTS, 'sales.documents.templates.invoice.labels', translate),
      document: {
        id: order.id,
        number: order.orderNumber,
        date: order.placedAt ?? order.createdAt,
        dueDate: order.dueAt ?? undefined,
      },
      client: {
        name: resolveClientName(customerSnapshot),
        email: firstText(contact?.email, customer?.primaryEmail),
        company: firstText(billingSnapshot?.companyName, companyProfile?.legalName, companyProfile?.brandName),
        address: resolveClientAddress(billingSnapshot),
      },
      seller: sellerName
        ? {
            name: sellerName,
            email: toText(channel?.contactEmail),
            phone: toText(channel?.contactPhone),
          }
        : undefined,
      lines: normalizedLines,
      totals: {
        ...reconcileDocumentTotals({
          lineTotals: normalizedLines.map((line) => line.total),
          subtotalNet: toNumber(order.subtotalNetAmount),
          grandTotalGross: toNumber(order.grandTotalGrossAmount),
          shipping: toNumber(order.shippingNetAmount),
          surcharge: toNumber(order.surchargeTotalAmount),
        }),
        paid: toNumber(order.paidTotalAmount),
        outstanding: toNumber(order.outstandingAmount),
        currency,
      },
      notes: toText(order.comments),
    }
  }

  resourceId({ data }: DocumentDataInput): string {
    return String((data as { document?: { id?: unknown } }).document?.id ?? '')
  }

  override resourceLabel({ data }: DocumentDataInput): string | undefined {
    const number = (data as { document?: { number?: unknown } }).document?.number
    return typeof number === 'string' && number.length > 0 ? number : undefined
  }
}
