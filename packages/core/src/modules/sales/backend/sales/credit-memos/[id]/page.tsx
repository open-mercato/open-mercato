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

type CreditMemoRecord = {
  id: string
  creditMemoNumber: string
  status?: string | null
  reason?: string | null
  issueDate?: string | null
  currencyCode?: string
  subtotalNetAmount?: string
  subtotalGrossAmount?: string
  taxTotalAmount?: string
  grandTotalNetAmount?: string
  grandTotalGrossAmount?: string
  orderId?: string | null
  invoiceId?: string | null
  lines?: Array<{
    id: string
    lineNumber: number
    name?: string | null
    sku?: string | null
    description?: string | null
    quantity: string
    quantityUnit?: string | null
    unitPriceNet: string
    unitPriceGross: string
    taxRate: string
    taxAmount: string
    totalNetAmount: string
    totalGrossAmount: string
  }>
}

export default function SalesCreditMemoDetailPage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const [loading, setLoading] = React.useState(true)
  const [record, setRecord] = React.useState<CreditMemoRecord | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    async function load() {
      setLoading(true)
      const result = await apiCall<{ items?: CreditMemoRecord[] }>(`/api/sales/credit-memos?id=${params.id}&populate=lines`)
      if (result.ok && result.result?.items?.[0]) {
        setRecord(result.result.items[0] as CreditMemoRecord)
      } else {
        setError(t('sales.credit_memos.errors.notFound', 'Credit memo not found'))
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
        title={`${t('sales.credit_memos.title', 'Credit Memo')} ${record.creditMemoNumber}`}
        backHref="/backend/sales/credit-memos"
      />
      <PageBody>
        <div className="space-y-6">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <div className="text-sm text-muted-foreground">{t('sales.credit_memos.columns.status', 'Status')}</div>
              <div className="font-medium">{record.status ?? '—'}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">{t('sales.credit_memos.columns.issueDate', 'Issue Date')}</div>
              <div className="font-medium">
                {record.issueDate ? new Date(record.issueDate).toLocaleDateString() : '—'}
              </div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">{t('sales.credit_memos.columns.total', 'Total')}</div>
              <div className="font-medium">
                {record.grandTotalGrossAmount
                  ? `${Number(record.grandTotalGrossAmount).toFixed(2)} ${record.currencyCode ?? ''}`
                  : '—'}
              </div>
            </div>
            {record.reason && (
              <div>
                <div className="text-sm text-muted-foreground">{t('sales.credit_memos.columns.reason', 'Reason')}</div>
                <div className="font-medium">{record.reason}</div>
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 font-semibold">{t('sales.credit_memos.totals', 'Totals')}</h3>
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('sales.credit_memos.subtotalNet', 'Subtotal (net)')}</span>
                <span>{Number(record.subtotalNetAmount ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('sales.credit_memos.tax', 'Tax')}</span>
                <span>{Number(record.taxTotalAmount ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>{t('sales.credit_memos.grandTotal', 'Grand Total')}</span>
                <span>{Number(record.grandTotalGrossAmount ?? 0).toFixed(2)} {record.currencyCode}</span>
              </div>
            </div>
          </div>

          {/* Lines */}
          {record.lines && record.lines.length > 0 && (
            <div className="rounded-lg border p-4">
              <h3 className="mb-3 font-semibold">{t('sales.credit_memos.lines', 'Line Items')}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2">#</th>
                    <th className="pb-2">{t('sales.credit_memos.line.name', 'Item')}</th>
                    <th className="pb-2">{t('sales.credit_memos.line.sku', 'SKU')}</th>
                    <th className="pb-2 text-right">{t('sales.credit_memos.line.qty', 'Qty')}</th>
                    <th className="pb-2 text-right">{t('sales.credit_memos.line.unitPrice', 'Unit Price')}</th>
                    <th className="pb-2 text-right">{t('sales.credit_memos.line.tax', 'Tax')}</th>
                    <th className="pb-2 text-right">{t('sales.credit_memos.line.total', 'Total')}</th>
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

          {/* Related document links */}
          <div className="flex gap-2">
            {record.orderId && (
              <Button variant="outline" onClick={() => router.push(`/backend/sales/orders/${record.orderId}`)}>
                {t('sales.credit_memos.viewOrder', 'View Source Order')}
              </Button>
            )}
            {record.invoiceId && (
              <Button variant="outline" onClick={() => router.push(`/backend/sales/invoices/${record.invoiceId}`)}>
                {t('sales.credit_memos.viewInvoice', 'View Source Invoice')}
              </Button>
            )}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
