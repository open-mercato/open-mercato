import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { BaseDocumentService } from '../base-document-service'
import { formatDate } from '../../utils/formatDate'
import { orderDocumentInputSchema } from './validators'
import {
  documentNumber,
  parseSnapshot,
  type BillingAddressSnapshot,
  type CustomerSnapshot,
} from '../sales-document-snapshots'
import type {
  CustomerAddressRow,
  EntityCtor,
  OrderLineItem,
  OrderRecord,
  SalesOrderRow,
} from './types'

/** Template IDs registered by this service — exported for TemplateId type derivation. */
export const ORDERS_TEMPLATE_IDS = ['order-invoice', 'order-invoice-markdown'] as const

/**
 * Document service for the Orders module.
 *
 * fetchData loads the full order from the database.
 * normalizeRecord maps it to the flat shape expected by PDF templates.
 */
export class OrdersDocumentService extends BaseDocumentService {
  readonly id = 'orders'
  readonly label = 'Orders'
  readonly module = 'sales'
  readonly resourceKind = 'sales.order'

  constructor() {
    super()

    this.registerTemplate({
      id: 'order-invoice',
      label: 'Order Invoice',
      description: 'Standard invoice for a sales order.',
      documentType: 'invoice',
      format: 'pdf',
      tags: ['invoice', 'order', 'sales'],
      note: 'Rendered in the Documents tab on the Order detail page (sales.document.detail.order:tabs).',
      load: () =>
        import('../../templates/sales/orders/order-invoice/pdf').then(
          (m) => ({
            type: 'react-pdf' as const,
            component: m.OrderInvoiceDocument as unknown as React.ComponentType<{ data: Record<string, unknown> }>,
          })
        ),
    })

    this.registerTemplate({
      id: 'order-invoice-markdown',
      label: 'Order Invoice — Markdown',
      description: 'Markdown invoice for a sales order.',
      documentType: 'invoice',
      format: 'md',
      tags: ['invoice', 'order', 'sales', 'markdown'],
      note: 'Rendered in the Documents tab on the Order detail page (sales.document.detail.order:tabs).',
      filename: ({ data }) => {
        const number = documentNumber(data)
        return number ? `invoice-${number}.md` : 'invoice.md'
      },
      load: () =>
        import('../../templates/sales/orders/order-invoice/markdown').then(
          (module) => ({
            type: 'markdown' as const,
            render: module.renderOrderInvoiceMarkdown,
          }),
        ),
    })
  }

  /**
   * Loads the full order with line items from the database.
   * The widget only needs to pass { id }.
   *
   * @param record - Widget record containing at minimum { id }
   * @param container - Request-scoped Awilix DI container
   */
  override async fetchData({ data }: { data: unknown }, { container, auth }: { container: AppContainer; auth: AuthContext | null }): Promise<unknown> {
    const { id } = orderDocumentInputSchema.parse(data)

    if (!auth?.tenantId || !auth?.orgId) throw new Error('[OrdersDocumentService] Missing auth context — tenantId and orgId are required to fetch order data.')

    const em = container.resolve('em') as Parameters<typeof findOneWithDecryption>[0]
    const SalesOrder = container.resolve('SalesOrder') as unknown as EntityCtor<SalesOrderRow>

    const order = await findOneWithDecryption<SalesOrderRow>(em, SalesOrder, {
      id,
      tenantId: auth.tenantId,
      organizationId: auth.orgId,
    }, { populate: ['lines'] })
    if (!order) throw new Error('[OrdersDocumentService] Order not found or not accessible')

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
      const CustomerAddress = container.resolve('CustomerAddress') as unknown as EntityCtor<CustomerAddressRow>
      const address = await findOneWithDecryption<CustomerAddressRow>(em, CustomerAddress, { entity: order.customerEntityId, isPrimary: true })
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
  }

  override filename({ data }: { data: Record<string, unknown> }): string {
    const num = documentNumber(data)
    return num ? `invoice-${num}.pdf` : 'invoice.pdf'
  }

  override resourceLabel({ data }: { data: Record<string, unknown> }): string | undefined {
    return (data.document as { number?: string } | undefined)?.number
  }

  override resourceId({ data }: { data: Record<string, unknown> }): string | undefined {
    return (data.document as { id?: string } | undefined)?.id
  }

  toTemplateData({ data, locale }: { data: unknown; locale: string }): Record<string, unknown> {
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
