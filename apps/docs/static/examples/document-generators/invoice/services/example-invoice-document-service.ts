import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { BaseDocumentService, type TemplateDataContext } from '@open-mercato/shared/modules/document-generators'
import { formatDate } from '@open-mercato/document-generators/modules/document_generators/utils/formatDate'
import { z } from 'zod'

const logger = createLogger('example').child({ component: 'example-invoice-document-service' })
const orderInputSchema = z.object({ id: z.string().uuid() })

/** Template IDs registered by this service — exported for TemplateId type derivation. */
export const EXAMPLE_INVOICE_TEMPLATE_IDS = ['example-invoice'] as const

/** Fully loaded order data fetched from the database by fetchData. */
export interface OrderRecord {
  id: string
  orderNumber: string
  currencyCode: string
  placedAt: Date | null
  expectedDeliveryAt: Date | null
  comments: string | null
  grandTotalNetAmount: string
  grandTotalGrossAmount: string
  taxTotalAmount: string
  customerSnapshot: string | Record<string, unknown> | null
  billingAddressSnapshot: string | Record<string, unknown> | null
  lines: OrderLineItem[]
}

export interface OrderLineItem {
  id: string
  name: string | null
  description: string | null
  quantity: string
  unitPriceNet: string
  unitPriceGross: string
  totalNetAmount: string
  totalGrossAmount: string
  taxRate: string
  currencyCode: string
}

interface SalesOrderRow extends Omit<OrderRecord, 'lines'> {
  customerEntityId: string | null
  lines: { getItems(): OrderLineItem[] }
}

interface CustomerAddressRow {
  addressLine1: string
  addressLine2: string | null
  city: string | null
  region: string | null
  postalCode: string | null
  country: string | null
}

interface CustomerSnapshot {
  contact?: { firstName?: string; lastName?: string }
  customer?: {
    displayName?: string
    primaryEmail?: string
    personProfile?: { firstName?: string; lastName?: string }
    companyProfile?: { legalName?: string; brandName?: string }
  }
}

interface BillingAddressSnapshot {
  addressLine1?: string
  addressLine2?: string | null
  city?: string | null
  region?: string | null
  postalCode?: string | null
  country?: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSnapshot<T extends object>(value: string | Record<string, unknown> | null): T | undefined {
  if (!value) return undefined
  if (typeof value !== 'string') return value as T

  try {
    const parsed: unknown = JSON.parse(value)
    return isRecord(parsed) ? parsed as T : undefined
  } catch {
    return undefined
  }
}

function documentNumber(data: Record<string, unknown>): string | undefined {
  const document = data.document
  return isRecord(document) && typeof document.number === 'string' ? document.number : undefined
}

/**
 * Example document service — demonstrates external template registration for sales orders.
 * This is a working copy of OrdersDocumentService adapted for use outside the document-generators package.
 *
 * - `readonly module`       top-level module name — used for grouping on the backend page
 * - `readonly resourceKind` matches ctx.resourceKind in the widget (e.g. 'sales.order')
 */
export class ExampleInvoicesDocumentService extends BaseDocumentService {
  readonly id = 'example-invoices'
  readonly label = 'Example Invoices'
  readonly module = 'sales'
  readonly resourceKind = 'sales.order'

  constructor() {
    super()

    this.registerTemplate({
      id: 'example-invoice',
      label: 'Example Invoice',
      description: 'Invoice template for a sales order.',
      documentType: 'invoice',
      format: 'pdf',
      tags: ['invoice', 'order', 'sales'],
      note: 'Rendered in the Documents tab on the Order detail page (sales.document.detail.order:tabs).',
      load: () =>
        import('../templates/example-invoice/pdf').then(
          (m) => ({
            type: 'react-pdf' as const,
            component: m.ExampleInvoiceDocument as unknown as React.ComponentType<{ data: Record<string, unknown> }>,
          })
        ),
    })
  }

  /**
   * Loads the full order with line items from the database.
   * The widget only needs to pass { id }.
   */
  override async fetchData({ data }: { data: unknown }, { container }: { container: AppContainer }): Promise<unknown> {
    const parsed = orderInputSchema.safeParse(data)
    if (!parsed.success) return data
    const { id } = parsed.data

    try {
      const em = container.resolve('em') as {
        findOne<T>(entity: unknown, where: unknown, options?: unknown): Promise<T | null>
      }
      const SalesOrder = container.resolve('SalesOrder')

      const order = await em.findOne<SalesOrderRow>(SalesOrder, { id }, { populate: ['lines'] })
      if (!order) return data

      const lines: OrderLineItem[] = (order.lines?.getItems?.() ?? []).map((line) => ({
        id: line.id,
        name: line.name ?? null,
        description: line.description ?? null,
        quantity: line.quantity ?? '0',
        unitPriceNet: line.unitPriceNet ?? '0',
        unitPriceGross: line.unitPriceGross ?? '0',
        totalNetAmount: line.totalNetAmount ?? '0',
        totalGrossAmount: line.totalGrossAmount ?? '0',
        taxRate: line.taxRate ?? '0',
        currencyCode: line.currencyCode,
      }))

      let billingAddressSnapshot = order.billingAddressSnapshot ?? null

      // fall back to the customer's primary address when the order has no billing address snapshot
      if (!billingAddressSnapshot && order.customerEntityId) {
        const CustomerAddress = container.resolve('CustomerAddress')
        const address = await em.findOne<CustomerAddressRow>(CustomerAddress, { entity: order.customerEntityId, isPrimary: true })
        if (address) {
          billingAddressSnapshot = {
            addressLine1: address.addressLine1,
            addressLine2: address.addressLine2 ?? null,
            city: address.city ?? null,
            region: address.region ?? null,
            postalCode: address.postalCode ?? null,
            country: address.country ?? null,
          }
        }
      }

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        currencyCode: order.currencyCode,
        placedAt: order.placedAt ?? null,
        expectedDeliveryAt: order.expectedDeliveryAt ?? null,
        comments: order.comments ?? null,
        grandTotalNetAmount: order.grandTotalNetAmount,
        grandTotalGrossAmount: order.grandTotalGrossAmount,
        taxTotalAmount: order.taxTotalAmount,
        customerSnapshot: order.customerSnapshot ?? null,
        billingAddressSnapshot,
        lines,
      } satisfies OrderRecord
    } catch (err) {
      logger.error('Failed to load invoice data', { err })
      return data
    }
  }

  override filename({ data }: { data: Record<string, unknown> }): string {
    const num = documentNumber(data)
    return num ? `invoice-${num}.pdf` : 'invoice.pdf'
  }

  override resourceId({ data }: { data: Record<string, unknown> }): string {
    const id = (data.document as { id?: string } | undefined)?.id
    if (!id) throw new Error('[internal] Example invoice normalized data is missing document.id')
    return id
  }

  override resourceLabel({ data }: { data: Record<string, unknown> }): string | undefined {
    return (data.document as { number?: string } | undefined)?.number
  }

  toTemplateData({ data, locale }: { data: unknown } & TemplateDataContext): Record<string, unknown> {
    const r = data as OrderRecord
    const customer = parseSnapshot<CustomerSnapshot>(r.customerSnapshot)
    const billing = parseSnapshot<BillingAddressSnapshot>(r.billingAddressSnapshot)

    const addressParts = [
      billing?.addressLine1,
      billing?.addressLine2,
      [billing?.postalCode, billing?.city].filter(Boolean).join(' '),
      billing?.region,
      billing?.country,
    ].filter(Boolean)

    const lines = (r.lines ?? []).map((line) => ({
      title: line.name ?? '',
      description: line.description ?? undefined,
      quantity: Number(line.quantity),
      unitPrice: Number(line.unitPriceNet),
      total: Number(line.totalNetAmount),
      currency: line.currencyCode,
    }))

    return {
      document: {
        id: r.id,
        number: r.orderNumber,
        date: r.placedAt ? formatDate(r.placedAt.toISOString(), locale) : formatDate(new Date().toISOString(), locale),
        dueDate: r.expectedDeliveryAt ? formatDate(r.expectedDeliveryAt.toISOString(), locale) : undefined,
      },
      client: {
        name: customer?.contact
          ? `${customer.contact.firstName} ${customer.contact.lastName}`
          : (customer?.customer?.personProfile
            ? `${customer.customer.personProfile.firstName} ${customer.customer.personProfile.lastName}`
            : (customer?.customer?.displayName ?? '')),
        company: customer?.customer?.companyProfile?.legalName ?? customer?.customer?.companyProfile?.brandName ?? undefined,
        email: customer?.customer?.primaryEmail ?? undefined,
        address: addressParts.length > 0 ? addressParts.join(', ') : undefined,
      },
      seller: {
        name: '',
        company: '',
        email: '',
      },
      lines,
      totals: {
        subtotal: Number(r.grandTotalNetAmount ?? 0),
        tax: Number(r.taxTotalAmount ?? 0),
        total: Number(r.grandTotalGrossAmount ?? 0),
        currency: r.currencyCode,
      },
      notes: r.comments ?? undefined,
    }
  }
}
