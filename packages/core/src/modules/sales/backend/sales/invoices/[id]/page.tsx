"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormHeader } from '@open-mercato/ui/backend/forms'

type InvoiceRecord = {
  id: string
  invoiceNumber: string
  status?: string | null
  issueDate?: string | null
  dueDate?: string | null
  currencyCode?: string
  subtotalNetAmount?: string
  subtotalGrossAmount?: string
  discountTotalAmount?: string
  taxTotalAmount?: string
  grandTotalNetAmount?: string
  grandTotalGrossAmount?: string
  paidTotalAmount?: string
  outstandingAmount?: string
  orderId?: string | null
  lines?: Array<{
    id: string
    lineNumber: number
    name?: string | null
    sku?: string | null
    description?: string | null
    kind?: string
    quantity: string
    quantityUnit?: string | null
    unitPriceNet: string
    unitPriceGross: string
    taxRate: string
    taxAmount: string
    totalNetAmount: string
    totalGrossAmount: string
  }>
  metadata?: Record<string, unknown> | null
}

export default function SalesInvoiceDetailPage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const [loading, setLoading] = React.useState(true)
  const [record, setRecord] = React.useState<InvoiceRecord | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    async function load() {
      setLoading(true)
      const result = await apiCall<{ items?: InvoiceRecord[] }>(`/api/sales/invoices?id=${params.id}&populate=lines`)
      if (result.ok && result.result?.items?.[0]) {
        setRecord(result.result.items[0] as InvoiceRecord)
      } else {
        setError(t('sales.invoices.errors.notFound', 'Invoice not found'))
      }
      setLoading(false)
    }
    load()
  }, [params.id, t])

  if (loading) return <LoadingMessage label={t('common.loading', 'Loading...')} />
  if (error || !record) return <ErrorMessage label={error ?? 'Not found'} />

  return (
    <Page>
      <FormHeader
        title={`${t('sales.invoices.title', 'Invoice')} ${record.invoiceNumber}`}
        backHref="/backend/sales/invoices"
      />
      <PageBody>
        <div className="space-y-6">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <div className="text-sm text-muted-foreground">{t('sales.invoices.columns.status', 'Status')}</div>
              <div className="font-medium">{record.status ?? '—'}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">{t('sales.invoices.columns.issueDate', 'Issue Date')}</div>
              <div className="font-medium">
                {record.issueDate ? new Date(record.issueDate).toLocaleDateString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">{t('sales.invoices.columns.dueDate', 'Due Date')}</div>
              <div className="font-medium">
                {record.dueDate ? new Date(record.dueDate).toLocaleDateString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">{t('sales.invoices.columns.total', 'Total')}</div>
              <div className="font-medium">
                {record.grandTotalGrossAmount
                  ? `${Number(record.grandTotalGrossAmount).toFixed(2)} ${record.currencyCode ?? ''}`
                  : '—'}
              </div>
            </div>
          </div>

          {/* Totals */}
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 font-semibold">{t('sales.invoices.totals', 'Totals')}</h3>
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('sales.invoices.subtotalNet', 'Subtotal (net)')}</span>
                <span>{Number(record.subtotalNetAmount ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('sales.invoices.tax', 'Tax')}</span>
                <span>{Number(record.taxTotalAmount ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('sales.invoices.discount', 'Discount')}</span>
                <span>{Number(record.discountTotalAmount ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>{t('sales.invoices.grandTotal', 'Grand Total')}</span>
                <span>{Number(record.grandTotalGrossAmount ?? 0).toFixed(2)} {record.currencyCode}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('sales.invoices.paid', 'Paid')}</span>
                <span>{Number(record.paidTotalAmount ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('sales.invoices.outstanding', 'Outstanding')}</span>
                <span>{Number(record.outstandingAmount ?? 0).toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Lines */}
          {record.lines && record.lines.length > 0 && (
            <div className="rounded-lg border p-4">
              <h3 className="mb-3 font-semibold">{t('sales.invoices.lines', 'Line Items')}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2">#</th>
                    <th className="pb-2">{t('sales.invoices.line.name', 'Item')}</th>
                    <th className="pb-2">{t('sales.invoices.line.sku', 'SKU')}</th>
                    <th className="pb-2 text-right">{t('sales.invoices.line.qty', 'Qty')}</th>
                    <th className="pb-2 text-right">{t('sales.invoices.line.unitPrice', 'Unit Price')}</th>
                    <th className="pb-2 text-right">{t('sales.invoices.line.tax', 'Tax')}</th>
                    <th className="pb-2 text-right">{t('sales.invoices.line.total', 'Total')}</th>
                  </tr>
                </thead>
                <tbody>
                  {record.lines.map((line) => (
                    <tr key={line.id} className="border-b last:border-0">
                      <td className="py-2">{line.lineNumber}</td>
                      <td className="py-2">{line.name ?? line.description ?? '—'}</td>
                      <td className="py-2 text-muted-foreground">{line.sku ?? '—'}</td>
                      <td className="py-2 text-right">{Number(line.quantity).toFixed(2)} {line.quantityUnit ?? ''}</td>
                      <td className="py-2 text-right">{Number(line.unitPriceGross).toFixed(2)}</td>
                      <td className="py-2 text-right">{Number(line.taxAmount).toFixed(2)} ({Number(line.taxRate).toFixed(0)}%)</td>
                      <td className="py-2 text-right font-medium">{Number(line.totalGrossAmount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Order link */}
          {record.orderId && (
            <div>
              <Button variant="outline" onClick={() => router.push(`/backend/sales/orders/${record.orderId}`)}>
                {t('sales.invoices.viewOrder', 'View Source Order')}
              </Button>
            </div>
          )}
        </div>
      </PageBody>
    </Page>
  )
}
