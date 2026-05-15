"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type FinancialDocumentKind = 'invoice' | 'credit-memo'

type FinancialDocumentRecord = {
  id: string
  invoiceNumber?: string
  creditMemoNumber?: string
  status?: string | null
  reason?: string | null
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
  invoiceId?: string | null
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

type KindConfig = {
  apiPath: string
  numberField: keyof FinancialDocumentRecord
  i18nPrefix: string
  listPath: string
}

const kindConfigs: Record<FinancialDocumentKind, KindConfig> = {
  'invoice': {
    apiPath: '/api/sales/invoices',
    numberField: 'invoiceNumber',
    i18nPrefix: 'sales.invoices',
    listPath: '/backend/sales/invoices',
  },
  'credit-memo': {
    apiPath: '/api/sales/credit-memos',
    numberField: 'creditMemoNumber',
    i18nPrefix: 'sales.credit_memos',
    listPath: '/backend/sales/credit-memos',
  },
}

export default function FinancialDocumentDetailPage({
  params,
  kind,
}: {
  params: { id: string }
  kind: FinancialDocumentKind
}) {
  const t = useT()
  const config = kindConfigs[kind]
  const [loading, setLoading] = React.useState(true)
  const [record, setRecord] = React.useState<FinancialDocumentRecord | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const result = await apiCall<{ items?: FinancialDocumentRecord[] }>(
          `${config.apiPath}?id=${params.id}&pageSize=1`,
        )
        if (result.ok && result.result?.items?.[0]) {
          setRecord(result.result.items[0])
        } else {
          setNotFound(true)
        }
      } catch {
        const message = t(`${config.i18nPrefix}.errors.loadFailed`, `Failed to load ${kind}`)
        setError(message)
        flash(message, 'error')
      }
      setLoading(false)
    }
    load()
  }, [params.id, t, config.apiPath, config.i18nPrefix, kind])

  if (loading) return <LoadingMessage label={t('common.loading', 'Loading...')} />

  if (notFound) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={t(`${config.i18nPrefix}.errors.notFound`, `${kind === 'invoice' ? 'Invoice' : 'Credit memo'} not found`)} />
          <div className="mt-4">
            <Link href={config.listPath} className="text-sm text-primary hover:underline">
              {t(`${config.i18nPrefix}.backToList`, `← Back to ${kind === 'invoice' ? 'invoices' : 'credit memos'}`)}
            </Link>
          </div>
        </PageBody>
      </Page>
    )
  }

  if (error || !record) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('common.error', 'An error occurred')} />
          <div className="mt-4">
            <Link href={config.listPath} className="text-sm text-primary hover:underline">
              {t(`${config.i18nPrefix}.backToList`, `← Back to ${kind === 'invoice' ? 'invoices' : 'credit memos'}`)}
            </Link>
          </div>
        </PageBody>
      </Page>
    )
  }

  const documentNumber = String(record[config.numberField] ?? '')

  return (
    <Page>
      <FormHeader
        title={`${t(`${config.i18nPrefix}.heading`, kind === 'invoice' ? 'Invoice' : 'Credit Memo')} ${documentNumber}`}
        backHref={config.listPath}
      />
      <PageBody>
        <div className="space-y-6">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <div className="text-sm text-muted-foreground">{t(`${config.i18nPrefix}.columns.status`, 'Status')}</div>
              <div className="font-medium">{record.status ?? '—'}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">{t(`${config.i18nPrefix}.columns.issueDate`, 'Issue Date')}</div>
              <div className="font-medium">
                {record.issueDate ? new Date(record.issueDate).toLocaleDateString() : '—'}
              </div>
            </div>
            {kind === 'invoice' && (
              <div>
                <div className="text-sm text-muted-foreground">{t('sales.invoices.columns.dueDate', 'Due Date')}</div>
                <div className="font-medium">
                  {record.dueDate ? new Date(record.dueDate).toLocaleDateString() : '—'}
                </div>
              </div>
            )}
            <div>
              <div className="text-sm text-muted-foreground">{t(`${config.i18nPrefix}.columns.total`, 'Total')}</div>
              <div className="font-medium">
                {record.grandTotalGrossAmount
                  ? `${Number(record.grandTotalGrossAmount).toFixed(2)} ${record.currencyCode ?? ''}`
                  : '—'}
              </div>
            </div>
            {kind === 'credit-memo' && record.reason && (
              <div>
                <div className="text-sm text-muted-foreground">{t('sales.credit_memos.columns.reason', 'Reason')}</div>
                <div className="font-medium">{record.reason}</div>
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="rounded-lg border p-4">
            <h3 className="mb-3 font-semibold">{t(`${config.i18nPrefix}.totals`, 'Totals')}</h3>
            <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t(`${config.i18nPrefix}.subtotalNet`, 'Subtotal (net)')}</span>
                <span>{Number(record.subtotalNetAmount ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t(`${config.i18nPrefix}.tax`, 'Tax')}</span>
                <span>{Number(record.taxTotalAmount ?? 0).toFixed(2)}</span>
              </div>
              {kind === 'invoice' && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('sales.invoices.discount', 'Discount')}</span>
                  <span>{Number(record.discountTotalAmount ?? 0).toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-semibold">
                <span>{t(`${config.i18nPrefix}.grandTotal`, 'Grand Total')}</span>
                <span>{Number(record.grandTotalGrossAmount ?? 0).toFixed(2)} {record.currencyCode}</span>
              </div>
              {kind === 'invoice' && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('sales.invoices.paid', 'Paid')}</span>
                    <span>{Number(record.paidTotalAmount ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{t('sales.invoices.outstanding', 'Outstanding')}</span>
                    <span>{Number(record.outstandingAmount ?? 0).toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Lines */}
          {record.lines && record.lines.length > 0 && (
            <div className="rounded-lg border p-4">
              <h3 className="mb-3 font-semibold">{t(`${config.i18nPrefix}.lines`, 'Line Items')}</h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2">#</th>
                    <th className="pb-2">{t(`${config.i18nPrefix}.line.name`, 'Item')}</th>
                    <th className="pb-2">{t(`${config.i18nPrefix}.line.sku`, 'SKU')}</th>
                    <th className="pb-2 text-right">{t(`${config.i18nPrefix}.line.qty`, 'Qty')}</th>
                    <th className="pb-2 text-right">{t(`${config.i18nPrefix}.line.unitPrice`, 'Unit Price')}</th>
                    <th className="pb-2 text-right">{t(`${config.i18nPrefix}.line.tax`, 'Tax')}</th>
                    <th className="pb-2 text-right">{t(`${config.i18nPrefix}.line.total`, 'Total')}</th>
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
              <Link href={`/backend/sales/orders/${record.orderId}`}>
                <Button variant="outline">
                  {t(`${config.i18nPrefix}.viewOrder`, 'View Source Order')}
                </Button>
              </Link>
            )}
            {kind === 'credit-memo' && record.invoiceId && (
              <Link href={`/backend/sales/invoices/${record.invoiceId}`}>
                <Button variant="outline">
                  {t('sales.credit_memos.viewInvoice', 'View Source Invoice')}
                </Button>
              </Link>
            )}
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
