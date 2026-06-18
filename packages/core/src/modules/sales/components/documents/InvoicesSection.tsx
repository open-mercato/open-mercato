"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ExternalLink, FileText, Plus } from 'lucide-react'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { ErrorMessage, LoadingMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatMoney, normalizeNumber } from './lineItemUtils'

type InvoiceRow = {
  id: string
  invoiceNumber: string
  status: string | null
  issueDate: string | null
  dueDate: string | null
  currencyCode: string | null
  grandTotalGrossAmount: number
  outstandingAmount: number
}

type SalesDocumentInvoicesSectionProps = {
  orderId: string
  currencyCode?: string | null
  organizationId?: string | null
  tenantId?: string | null
}

function readString(map: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = map[key]
    if (typeof value === 'string' && value.trim().length) return value
  }
  return null
}

function readNumber(map: Record<string, unknown>, fallback: number, ...keys: string[]): number {
  for (const key of keys) {
    const value = map[key]
    const normalized = normalizeNumber(value, Number.NaN)
    if (Number.isFinite(normalized)) return normalized
  }
  return fallback
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function formatDisplayDate(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function normalizeInvoice(item: Record<string, unknown>): InvoiceRow | null {
  const id = readString(item, 'id')
  if (!id) return null
  const invoiceNumber = readString(item, 'invoiceNumber', 'invoice_number') ?? id
  const currencyCode = readString(item, 'currencyCode', 'currency_code')
  return {
    id,
    invoiceNumber,
    status: readString(item, 'status'),
    issueDate: readString(item, 'issueDate', 'issue_date'),
    dueDate: readString(item, 'dueDate', 'due_date'),
    currencyCode,
    grandTotalGrossAmount: readNumber(item, 0, 'grandTotalGrossAmount', 'grand_total_gross_amount'),
    outstandingAmount: readNumber(item, 0, 'outstandingAmount', 'outstanding_amount'),
  }
}

function buildInvoiceLinePayload(line: Record<string, unknown>, fallbackCurrency: string, index: number) {
  const metadata = readRecord(line.metadata)
  return {
    orderLineId: readString(line, 'id') ?? undefined,
    lineNumber: readNumber(line, index + 1, 'lineNumber', 'line_number'),
    kind: readString(line, 'kind') ?? 'product',
    serviceId: readString(line, 'serviceId', 'service_id') ?? undefined,
    name: readString(line, 'name') ?? undefined,
    sku: readString(line, 'sku') ?? undefined,
    description: readString(line, 'description') ?? undefined,
    quantity: String(readNumber(line, 0, 'quantity')),
    quantityUnit: readString(line, 'quantityUnit', 'quantity_unit') ?? undefined,
    normalizedQuantity: String(readNumber(line, 0, 'normalizedQuantity', 'normalized_quantity')),
    normalizedUnit: readString(line, 'normalizedUnit', 'normalized_unit') ?? undefined,
    uomSnapshot: readRecord(line.uomSnapshot ?? line.uom_snapshot) ?? undefined,
    currencyCode: readString(line, 'currencyCode', 'currency_code') ?? fallbackCurrency,
    unitPriceNet: String(readNumber(line, 0, 'unitPriceNet', 'unit_price_net')),
    unitPriceGross: String(readNumber(line, 0, 'unitPriceGross', 'unit_price_gross')),
    discountAmount: String(readNumber(line, 0, 'discountAmount', 'discount_amount')),
    discountPercent: String(readNumber(line, 0, 'discountPercent', 'discount_percent')),
    taxRate: String(readNumber(line, 0, 'taxRate', 'tax_rate')),
    taxAmount: String(readNumber(line, 0, 'taxAmount', 'tax_amount')),
    totalNetAmount: String(readNumber(line, 0, 'totalNetAmount', 'total_net_amount')),
    totalGrossAmount: String(readNumber(line, 0, 'totalGrossAmount', 'total_gross_amount')),
    metadata: metadata ?? undefined,
  }
}

export function SalesDocumentInvoicesSection({
  orderId,
  currencyCode,
  organizationId,
  tenantId,
}: SalesDocumentInvoicesSectionProps) {
  const t = useT()
  const router = useRouter()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'sales-order-invoices',
  })
  const [invoices, setInvoices] = React.useState<InvoiceRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const loadInvoices = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100', orderId })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/invoices?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      const items = Array.isArray(response.result?.items) ? response.result?.items ?? [] : []
      setInvoices(items.map(normalizeInvoice).filter((row): row is InvoiceRow => Boolean(row)))
    } catch (err) {
      console.error('sales.invoices.listForOrder', err)
      setError(t('sales.invoices.errors.load', 'Failed to load invoices.'))
    } finally {
      setLoading(false)
    }
  }, [orderId, t])

  React.useEffect(() => {
    void loadInvoices()
  }, [loadInvoices])

  const createInvoice = React.useCallback(async () => {
    if (invoices.length > 0 || creating) return
    setCreating(true)
    try {
      const source = await runMutation({
        operation: async () => {
          const orderParams = new URLSearchParams({ page: '1', pageSize: '1', id: orderId })
          const linesParams = new URLSearchParams({ page: '1', pageSize: '100', orderId })
          const [orderResponse, lineResponse] = await Promise.all([
            apiCallOrThrow<{ items?: Array<Record<string, unknown>> }>(
              `/api/sales/orders?${orderParams.toString()}`,
              undefined,
              { errorMessage: t('sales.invoices.create.error', 'Failed to create invoice.') },
            ),
            apiCallOrThrow<{ items?: Array<Record<string, unknown>> }>(
              `/api/sales/order-lines?${linesParams.toString()}`,
              undefined,
              { errorMessage: t('sales.invoices.create.error', 'Failed to create invoice.') },
            ),
          ])
          const order = Array.isArray(orderResponse.result?.items) ? orderResponse.result?.items?.[0] ?? null : null
          if (!order) {
            throw new Error(t('sales.invoices.create.orderMissing', 'Order could not be loaded.'))
          }
          const resolvedCurrency = readString(order, 'currencyCode', 'currency_code') ?? currencyCode ?? null
          if (!resolvedCurrency) {
            throw new Error(t('sales.invoices.create.missingCurrency', 'Order currency is required to create an invoice.'))
          }
          const lines = Array.isArray(lineResponse.result?.items) ? lineResponse.result?.items ?? [] : []
          const totalGross = readNumber(order, 0, 'grandTotalGrossAmount', 'grand_total_gross_amount')
          const payload = {
            orderId,
            organizationId: organizationId ?? undefined,
            tenantId: tenantId ?? undefined,
            issueDate: new Date().toISOString(),
            currencyCode: resolvedCurrency,
            lines: lines.map((line, index) => buildInvoiceLinePayload(line, resolvedCurrency, index)),
            subtotalNetAmount: String(readNumber(order, 0, 'subtotalNetAmount', 'subtotal_net_amount')),
            subtotalGrossAmount: String(readNumber(order, 0, 'subtotalGrossAmount', 'subtotal_gross_amount')),
            discountTotalAmount: String(readNumber(order, 0, 'discountTotalAmount', 'discount_total_amount')),
            taxTotalAmount: String(readNumber(order, 0, 'taxTotalAmount', 'tax_total_amount')),
            grandTotalNetAmount: String(readNumber(order, 0, 'grandTotalNetAmount', 'grand_total_net_amount')),
            grandTotalGrossAmount: String(totalGross),
            paidTotalAmount: '0',
            outstandingAmount: String(totalGross),
          }
          const response = await apiCallOrThrow<{ invoiceId?: string; id?: string }>(
            '/api/sales/invoices',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            },
            { errorMessage: t('sales.invoices.create.error', 'Failed to create invoice.') },
          )
          return response.result ?? {}
        },
        context: {
          formId: 'sales-order-invoices',
          resourceKind: 'sales.invoice',
          resourceId: orderId,
          retryLastMutation,
        },
      })
      const invoiceId = typeof source.invoiceId === 'string' ? source.invoiceId : typeof source.id === 'string' ? source.id : null
      await loadInvoices()
      flash(t('sales.invoices.create.success', 'Invoice created.'), 'success')
      if (invoiceId) router.push(`/backend/sales/invoices/${invoiceId}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sales.invoices.create.error', 'Failed to create invoice.')
      flash(message, 'error')
    } finally {
      setCreating(false)
    }
  }, [creating, currencyCode, invoices.length, loadInvoices, orderId, organizationId, retryLastMutation, router, runMutation, t, tenantId])

  const hasInvoice = invoices.length > 0
  const actionLabel = hasInvoice
    ? t('sales.invoices.create.disabledExisting', 'Invoice already exists')
    : t('sales.invoices.createFromOrder', 'Create invoice')

  if (loading) return <LoadingMessage label={t('sales.invoices.loading', 'Loading invoices…')} />
  if (error) {
    return (
      <ErrorMessage
        label={error}
        action={
          <Button variant="outline" size="sm" onClick={() => void loadInvoices()}>
            {t('sales.invoices.retry', 'Retry')}
          </Button>
        }
      />
    )
  }

  if (!invoices.length) {
    return (
      <TabEmptyState
        title={t('sales.invoices.empty.title', 'No invoices yet.')}
        description={t('sales.invoices.empty.description', 'Create one full invoice from the current order lines and totals.')}
        action={{
          label: actionLabel,
          onClick: () => void createInvoice(),
          icon: <Plus className="h-4 w-4" aria-hidden />,
          disabled: creating,
        }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button type="button" onClick={() => void createInvoice()} disabled={hasInvoice || creating}>
          <Plus className="mr-2 h-4 w-4" aria-hidden />
          {actionLabel}
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
            <div>{t('sales.invoices.table.invoice', 'Invoice')}</div>
            <div className="text-right">{t('sales.invoices.table.issueDate', 'Issue date')}</div>
            <div className="text-right">{t('sales.invoices.table.total', 'Total')}</div>
            <div className="text-right">{t('sales.invoices.table.outstanding', 'Outstanding')}</div>
          </div>
          <div className="divide-y">
            {invoices.map((invoice) => (
              <Link
                key={invoice.id}
                href={`/backend/sales/invoices/${invoice.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-4 py-3 hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                    <span className="truncate text-sm font-medium">{invoice.invoiceNumber}</span>
                    {invoice.status ? <Badge variant="secondary">{invoice.status}</Badge> : null}
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </div>
                  {invoice.dueDate ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('sales.invoices.table.dueDate', 'Due')}: {formatDisplayDate(invoice.dueDate)}
                    </p>
                  ) : null}
                </div>
                <div className="whitespace-nowrap text-right text-sm text-muted-foreground">
                  {formatDisplayDate(invoice.issueDate) || t('sales.invoices.notSet', 'Not set')}
                </div>
                <div className="whitespace-nowrap text-right text-sm font-medium">
                  {formatMoney(invoice.grandTotalGrossAmount, invoice.currencyCode ?? currencyCode ?? null)}
                </div>
                <div className="whitespace-nowrap text-right text-sm font-medium">
                  {formatMoney(invoice.outstandingAmount, invoice.currencyCode ?? currencyCode ?? null)}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
