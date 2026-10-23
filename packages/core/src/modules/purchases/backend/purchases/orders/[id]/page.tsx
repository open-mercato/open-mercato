"use client"

import * as React from 'react'
import { useParams, useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import {
  ArrowLeft,
  CheckCircle2,
  Send,
  XCircle,
  ShieldAlert,
  Calendar,
  Building2,
  DollarSign,
  Truck,
  Receipt,
  ExternalLink,
} from 'lucide-react'
import { PurchaseOrderStatusBadge } from '../../../../components/PurchaseOrderStatusBadge'

type OrderLine = {
  id: string
  productId?: string | null
  vendorProductCode?: string | null
  productDescription: string
  quantityOrdered: string
  quantityReceived: string
  quantityBilled: string
  unitPriceNet: string
  taxRatePercent: string
  subtotalNet: string
  totalGross: string
}

type OrderDetail = {
  id: string
  orderNumber: string
  status: string
  vendorId: string
  vendorName?: string | null
  orderDate: string
  expectedArrivalDate?: string | null
  currencyCode: string
  exchangeRate: string
  incoterm?: string | null
  approvalStatus: string
  invoiceStatus: string
  deliveryStatus: string
  subtotalNet: string
  totalTax: string
  totalGross: string
  notes?: string | null
  updatedAt: string
  lines: OrderLine[]
}

const pipelineStates = [
  { key: 'draft_rfq', label: 'Draft RFQ' },
  { key: 'rfq_sent', label: 'RFQ Sent' },
  { key: 'to_approve', label: 'To Approve' },
  { key: 'purchase_order', label: 'Purchase Order' },
  { key: 'locked', label: 'Done / Locked' },
]

export default function PurchaseOrderDetailPage(props: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const clientParams = useParams()

  const orderId = React.useMemo(() => {
    if (typeof props?.params?.id === 'string' && props.params.id) return props.params.id
    if (clientParams) {
      if (typeof clientParams.id === 'string' && clientParams.id) return clientParams.id
      if (Array.isArray(clientParams.id) && clientParams.id[0]) return clientParams.id[0]
      if (Array.isArray(clientParams.slug) && clientParams.slug.length > 0) {
        const last = clientParams.slug[clientParams.slug.length - 1]
        if (last && last !== 'create' && last !== 'edit' && last !== 'orders') return last
      }
    }
    if (pathname) {
      const parts = pathname.split('/').filter(Boolean)
      const last = parts[parts.length - 1]
      if (last && last !== 'orders') return last
    }
    return ''
  }, [props?.params, clientParams, pathname])
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const [order, setOrder] = React.useState<OrderDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [acting, setActing] = React.useState(false)

  const fetchOrder = React.useCallback(async () => {
    try {
      const call = await apiCall<OrderDetail>(`/api/purchases/orders/${orderId}`)
      if (call.ok && call.result) {
        setOrder(call.result)
      } else {
        setOrder(null)
      }
    } catch (err: unknown) {
      flash((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }, [orderId])

  React.useEffect(() => {
    if (orderId) {
      fetchOrder()
    }
  }, [fetchOrder, orderId])

  const handleAction = async (endpoint: string, successMessage: string) => {
    setActing(true)
    try {
      const call = await apiCall<{ error?: string }>(`/api/purchases/orders/${orderId}/${endpoint}`, { method: 'POST' })
      if (!call.ok) {
        throw new Error(call.result?.error || 'Operation failed')
      }
      flash(successMessage, 'success')
      await fetchOrder()
    } catch (err: unknown) {
      flash((err as Error).message, 'error')
    } finally {
      setActing(false)
    }
  }

  const handleCancel = async () => {
    const ok = await confirm({
      title: t('purchases.orders.cancel.confirm_title', 'Cancel Purchase Order'),
      text: t('purchases.orders.cancel.confirm_msg', 'Are you sure you want to cancel this order?'),
      confirmText: t('common.cancel', 'Cancel Order'),
      variant: 'destructive',
    })
    if (!ok) return
    await handleAction('cancel', t('purchases.orders.cancelled_success', 'Order cancelled'))
  }

  if (loading) {
    return (
      <Page>
        <PageBody>
          <div className="flex h-64 items-center justify-center text-muted-foreground">
            {t('common.loading', 'Loading purchase order...')}
          </div>
        </PageBody>
      </Page>
    )
  }

  if (!order) {
    return (
      <Page>
        <PageBody>
          <div className="flex flex-col items-center justify-center gap-4 py-16">
            <p className="text-muted-foreground">{t('purchases.orders.not_found', 'Order not found')}</p>
            <Link href="/backend/purchases/orders">
              <Button variant="outline">{t('common.back', 'Back to Orders')}</Button>
            </Link>
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        {/* Top Header & Navigation */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/backend/purchases/orders">
              <Button variant="outline" size="sm" aria-label="Back to orders">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight">{order.orderNumber}</h1>
                <PurchaseOrderStatusBadge status={order.status} />
              </div>
              <p className="text-sm text-muted-foreground">
                {order.vendorName || order.vendorId} • {new Date(order.orderDate).toLocaleDateString()}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {order.status === 'draft_rfq' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleAction('send', t('purchases.orders.sent_success', 'RFQ sent to supplier'))}
                disabled={acting}
                className="gap-1.5"
              >
                <Send className="h-4 w-4" />
                {t('purchases.orders.send_rfq', 'Send RFQ')}
              </Button>
            )}

            {(order.status === 'draft_rfq' || order.status === 'rfq_sent') && (
              <Button
                size="sm"
                onClick={() => handleAction('confirm', t('purchases.orders.confirmed_success', 'Order confirmed'))}
                disabled={acting}
                className="gap-1.5"
              >
                <CheckCircle2 className="h-4 w-4" />
                {t('purchases.orders.confirm_order', 'Confirm Order')}
              </Button>
            )}

            {order.status === 'to_approve' && (
              <Button
                size="sm"
                onClick={() => handleAction('approve', t('purchases.orders.approved_success', 'Order approved by manager'))}
                disabled={acting}
                className="gap-1.5 bg-status-success-bg text-status-success-text hover:bg-status-success-bg/90"
              >
                <ShieldAlert className="h-4 w-4" />
                {t('purchases.orders.approve_order', 'Approve Order (Manager)')}
              </Button>
            )}

            {order.status === 'purchase_order' && (
              <>
                <Link href={`/backend/purchases/receipts?orderId=${order.id}`}>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <Truck className="h-4 w-4" />
                    {t('purchases.orders.receive_products', 'Receive Products (PZ)')}
                  </Button>
                </Link>
                <Link href={`/backend/purchases/bills?orderId=${order.id}`}>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <Receipt className="h-4 w-4" />
                    {t('purchases.orders.vendor_bills', 'Vendor Bills')}
                  </Button>
                </Link>
              </>
            )}

            {order.status !== 'cancelled' && order.status !== 'locked' && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCancel}
                disabled={acting}
                className="gap-1.5 text-destructive hover:bg-destructive/10"
              >
                <XCircle className="h-4 w-4" />
                {t('common.cancel', 'Cancel Order')}
              </Button>
            )}
          </div>
        </div>

        {/* Status Pipeline Breadcrumb Bar */}
        <div className="mb-6 flex overflow-x-auto rounded-lg border bg-muted/30 p-2">
          {pipelineStates.map((state, idx) => {
            const isCurrent = order.status === state.key
            return (
              <div
                key={state.key}
                className={`flex flex-1 items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold ${
                  isCurrent
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground'
                }`}
              >
                <span className="mr-1.5 text-xs opacity-70">{idx + 1}.</span>
                {state.label}
              </div>
            )
          })}
        </div>

        {/* 2-Column Summary Cards */}
        <div className="mb-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="space-y-3 rounded-lg border bg-card p-5 text-sm shadow-sm">
            <h3 className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
              {t('purchases.orders.supplier_info', 'Supplier & Commercial Info')}
            </h3>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-foreground">{order.vendorName || 'Unnamed Vendor'}</span>
              <span className="text-xs text-muted-foreground">({order.vendorId})</span>
            </div>
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span>
                {t('purchases.orders.currency', 'Currency')}: <strong>{order.currencyCode}</strong> (Rate: {order.exchangeRate})
              </span>
            </div>
            {order.incoterm && (
              <div>
                {t('purchases.orders.incoterm', 'Incoterm')}: <strong>{order.incoterm}</strong>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-lg border bg-card p-5 text-sm shadow-sm">
            <h3 className="font-semibold text-muted-foreground uppercase tracking-wider text-xs">
              {t('purchases.orders.logistics_billing', 'Logistics & Billing')}
            </h3>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span>{t('purchases.orders.order_date', 'Order Date')}: {new Date(order.orderDate).toLocaleDateString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-muted-foreground" />
              <span>{t('purchases.orders.delivery_status', 'Delivery Status')}: <strong>{order.deliveryStatus}</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              <span>{t('purchases.orders.invoice_status', 'Invoice Status')}: <strong>{order.invoiceStatus}</strong></span>
            </div>
          </div>
        </div>

        {/* Order Lines Matrix */}
        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            {t('purchases.orders.order_lines', 'Order Lines')}
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-2.5">{t('purchases.orders.description', 'Product Description')}</th>
                  <th className="p-2.5 text-right">{t('purchases.orders.qty_ordered', 'Ordered')}</th>
                  <th className="p-2.5 text-right">{t('purchases.orders.qty_received', 'Received')}</th>
                  <th className="p-2.5 text-right">{t('purchases.orders.qty_billed', 'Billed')}</th>
                  <th className="p-2.5 text-right">{t('purchases.orders.unit_price', 'Net Price')}</th>
                  <th className="p-2.5 text-right">{t('purchases.orders.tax', 'Tax %')}</th>
                  <th className="p-2.5 text-right">{t('purchases.orders.subtotal', 'Subtotal Net')}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {order.lines.map((line) => (
                  <tr key={line.id} className="hover:bg-muted/30">
                    <td className="p-2.5 font-medium">
                      <div className="flex flex-col">
                        <span>{line.productDescription}</span>
                        <div className="flex items-center gap-2 mt-0.5 text-xs font-normal">
                          {line.vendorProductCode && (
                            <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                              Supplier SKU: {line.vendorProductCode}
                            </span>
                          )}
                          {line.productId && (
                            <Link
                              href={`/backend/catalog/products/${line.productId}`}
                              target="_blank"
                              className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5"
                            >
                              Catalog product <ExternalLink className="h-2.5 w-2.5" />
                            </Link>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-2.5 text-right">{Number(line.quantityOrdered).toFixed(2)}</td>
                    <td className="p-2.5 text-right font-medium text-primary">
                      {Number(line.quantityReceived).toFixed(2)}
                    </td>
                    <td className="p-2.5 text-right text-muted-foreground">
                      {Number(line.quantityBilled).toFixed(2)}
                    </td>
                    <td className="p-2.5 text-right">
                      {Number(line.unitPriceNet).toFixed(2)} {order.currencyCode}
                    </td>
                    <td className="p-2.5 text-right">{line.taxRatePercent}%</td>
                    <td className="p-2.5 text-right font-semibold">
                      {Number(line.subtotalNet).toFixed(2)} {order.currencyCode}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals Summary */}
          <div className="mt-6 flex justify-end">
            <div className="w-72 space-y-2 rounded-md bg-muted/40 p-4 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>{t('purchases.orders.total_net', 'Subtotal Net:')}</span>
                <span className="font-medium text-foreground">
                  {Number(order.subtotalNet).toFixed(2)} {order.currencyCode}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>{t('purchases.orders.total_tax', 'Total Tax:')}</span>
                <span className="font-medium text-foreground">
                  {Number(order.totalTax).toFixed(2)} {order.currencyCode}
                </span>
              </div>
              <div className="border-t pt-2 flex justify-between font-bold text-base">
                <span>{t('purchases.orders.total_gross', 'Total Gross:')}</span>
                <span className="text-primary">
                  {Number(order.totalGross).toFixed(2)} {order.currencyCode}
                </span>
              </div>
            </div>
          </div>
        </div>

        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
