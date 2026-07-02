"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, FileText, Trash2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { ErrorMessage, LoadingMessage, RecordNotFoundState, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { normalizeNumber } from './lineItemUtils'
import { formatInvoiceDate, formatInvoiceMoney, formatInvoiceStatus } from './invoiceDisplay'

type InvoiceHeader = {
  id: string
  orderId: string | null
  invoiceNumber: string
  statusEntryId: string | null
  status: string | null
  issueDate: string | null
  dueDate: string | null
  currencyCode: string
  subtotalNetAmount: string
  subtotalGrossAmount: string
  discountTotalAmount: string
  taxTotalAmount: string
  grandTotalNetAmount: string
  grandTotalGrossAmount: string
  paidTotalAmount: string
  outstandingAmount: string
  updatedAt: string | null
}

type InvoiceLine = {
  id: string
  orderLineId: string | null
  lineNumber: number
  name: string | null
  sku: string | null
  description: string | null
  quantity: string
  quantityUnit: string | null
  unitPriceNet: string
  unitPriceGross: string
  discountAmount: string
  taxRate: string
  taxAmount: string
  totalNetAmount: string
  totalGrossAmount: string
}

type InvoiceDetailResponse = {
  invoice?: InvoiceHeader
  lines?: InvoiceLine[]
}

type StatusOption = {
  id: string
  value: string
  label: string
}

const NO_INVOICE_STATUS_VALUE = '__open_mercato_invoice_status_none__'

function amount(value: string | number | null | undefined): number {
  return normalizeNumber(value, 0)
}

function normalizeStatusOption(entry: Record<string, unknown>): StatusOption | null {
  const id = typeof entry.id === 'string' && entry.id.trim().length ? entry.id : null
  const value = typeof entry.value === 'string' && entry.value.trim().length ? entry.value : null
  if (!id || !value) return null
  const label =
    typeof entry.label === 'string' && entry.label.trim().length
      ? entry.label.trim()
      : value
  return { id, value, label }
}

export function InvoiceDetailPage({ id }: { id: string }) {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'sales-invoice-detail',
  })
  const [invoice, setInvoice] = React.useState<InvoiceHeader | null>(null)
  const [lines, setLines] = React.useState<InvoiceLine[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [statusOptions, setStatusOptions] = React.useState<StatusOption[]>([])
  const [statusDraft, setStatusDraft] = React.useState('')
  const [statusLoading, setStatusLoading] = React.useState(false)
  const [statusSaving, setStatusSaving] = React.useState(false)

  const loadInvoice = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const payload = await readApiResultOrThrow<InvoiceDetailResponse>(
        `/api/sales/invoices/${id}`,
        undefined,
        { errorMessage: t('sales.invoices.detail.errorLoad', 'Failed to load invoice.') },
      )
      setInvoice(payload?.invoice ?? null)
      setLines(Array.isArray(payload?.lines) ? payload.lines : [])
    } catch (err) {
      console.error('sales.invoices.detail', err)
      setError(t('sales.invoices.detail.errorLoad', 'Failed to load invoice.'))
      setInvoice(null)
      setLines([])
    } finally {
      setLoading(false)
    }
  }, [id, t])

  const loadStatuses = React.useCallback(async () => {
    setStatusLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/order-statuses?${params.toString()}`,
        undefined,
        { fallback: { items: [] } },
      )
      if (!response.ok) {
        throw new Error(t('sales.invoices.detail.status.errorLoad', 'Failed to load invoice statuses.'))
      }
      const items = Array.isArray(response.result?.items) ? response.result.items : []
      setStatusOptions(
        items
          .map(normalizeStatusOption)
          .filter((entry): entry is StatusOption => Boolean(entry)),
      )
    } catch (err) {
      console.error('sales.invoices.statuses.load', err)
      setStatusOptions([])
      flash(t('sales.invoices.detail.status.errorLoad', 'Failed to load invoice statuses.'), 'error')
    } finally {
      setStatusLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    void loadInvoice()
  }, [loadInvoice])

  React.useEffect(() => {
    void loadStatuses()
  }, [loadStatuses])

  React.useEffect(() => {
    setStatusDraft(invoice?.statusEntryId ?? '')
  }, [invoice?.id, invoice?.statusEntryId])

  const visibleStatusOptions = React.useMemo(() => {
    if (!invoice?.statusEntryId || statusOptions.some((option) => option.id === invoice.statusEntryId)) {
      return statusOptions
    }
    const label = invoice.status ? formatInvoiceStatus(invoice.status, t) : invoice.statusEntryId
    return [...statusOptions, { id: invoice.statusEntryId, value: invoice.status ?? invoice.statusEntryId, label }]
  }, [invoice?.status, invoice?.statusEntryId, statusOptions, t])

  const handleDelete = React.useCallback(async () => {
    if (!invoice) return
    const confirmed = await confirm({
      title: t('sales.invoices.delete.confirmTitle', 'Delete invoice {invoiceNumber}?', { invoiceNumber: invoice.invoiceNumber }),
      description: t('sales.invoices.delete.confirmDescription', 'This action cannot be undone.'),
      confirmText: t('sales.invoices.delete.action', 'Delete invoice'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: async () => {
          await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(invoice.updatedAt),
            () =>
              deleteCrud('sales/invoices', {
                body: { id: invoice.id },
                errorMessage: t('sales.invoices.delete.error', 'Failed to delete invoice.'),
              }),
          )
        },
        context: {
          formId: 'sales-invoice-detail',
          resourceKind: 'sales.invoice',
          resourceId: invoice.id,
          retryLastMutation,
        },
      })
      flash(t('sales.invoices.delete.success', 'Invoice deleted.'), 'success')
      router.push('/backend/sales/invoices')
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sales.invoices.delete.error', 'Failed to delete invoice.')
      flash(message, 'error')
    }
  }, [confirm, invoice, retryLastMutation, router, runMutation, t])

  const handleStatusUpdate = React.useCallback(async () => {
    if (!invoice) return
    const nextStatusEntryId = statusDraft.trim().length ? statusDraft.trim() : null
    const currentStatusEntryId = invoice.statusEntryId ?? null
    if (nextStatusEntryId === currentStatusEntryId) return

    setStatusSaving(true)
    try {
      await runMutation({
        operation: async () => {
          await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(invoice.updatedAt),
            () =>
              updateCrud('sales/invoices', {
                id: invoice.id,
                statusEntryId: nextStatusEntryId,
                currencyCode: invoice.currencyCode,
              }, {
                errorMessage: t('sales.invoices.detail.status.errorSave', 'Failed to update invoice status.'),
              }),
          )
        },
        context: {
          formId: 'sales-invoice-detail',
          resourceKind: 'sales.invoice',
          resourceId: invoice.id,
          retryLastMutation,
        },
        mutationPayload: { statusEntryId: nextStatusEntryId },
      })
      flash(t('sales.invoices.detail.status.success', 'Invoice status updated.'), 'success')
      await loadInvoice()
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sales.invoices.detail.status.errorSave', 'Failed to update invoice status.')
      flash(message, 'error')
    } finally {
      setStatusSaving(false)
    }
  }, [invoice, loadInvoice, retryLastMutation, runMutation, statusDraft, t])

  if (loading) return <LoadingMessage label={t('sales.invoices.detail.loading', 'Loading invoice…')} />
  if (error) {
    return (
      <ErrorMessage
        label={error}
        action={
          <Button variant="outline" size="sm" onClick={() => void loadInvoice()}>
            {t('sales.invoices.retry', 'Retry')}
          </Button>
        }
      />
    )
  }
  if (!invoice) {
    return (
      <RecordNotFoundState
        label={t('sales.invoices.notFound', 'Invoice not found.')}
        backHref="/backend/sales/invoices"
        backLabel={t('sales.invoices.detail.backToList', 'Back to invoices')}
      />
    )
  }

  const currency = invoice.currencyCode
  const currentStatusEntryId = invoice.statusEntryId ?? ''
  const selectedStatusEntryId = statusDraft.trim()
  const statusChanged = selectedStatusEntryId !== currentStatusEntryId
  const statusSelectValue = selectedStatusEntryId || NO_INVOICE_STATUS_VALUE
  const canSaveStatus = statusChanged && !statusLoading && !statusSaving

  return (
    <Page>
      <PageBody>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Button asChild variant="ghost" size="sm" className="h-8 px-2">
                <Link href="/backend/sales/invoices">
                  <ArrowLeft className="mr-2 h-4 w-4" aria-hidden />
                  {t('sales.invoices.detail.backToList', 'Back to invoices')}
                </Link>
              </Button>
            </div>
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <h1 className="break-all text-2xl font-semibold leading-tight">{invoice.invoiceNumber}</h1>
                {invoice.status ? <Badge className="mt-2" variant="secondary">{formatInvoiceStatus(invoice.status, t)}</Badge> : null}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <div className="flex flex-wrap items-end justify-end gap-2">
              <div className="min-w-[14rem]">
                <label
                  htmlFor="sales-invoice-status"
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                >
                  {t('sales.invoices.detail.status.label', 'Invoice status')}
                </label>
                <Select
                  value={statusSelectValue}
                  onValueChange={(value) => {
                    setStatusDraft(value === NO_INVOICE_STATUS_VALUE ? '' : value)
                  }}
                  disabled={statusLoading || statusSaving}
                >
                  <SelectTrigger id="sales-invoice-status" size="sm">
                    <SelectValue placeholder={t('sales.invoices.detail.status.placeholder', 'Select status')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_INVOICE_STATUS_VALUE}>
                      {t('sales.invoices.detail.status.none', 'No status')}
                    </SelectItem>
                    {visibleStatusOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canSaveStatus}
                onClick={() => void handleStatusUpdate()}
              >
                {statusSaving
                  ? t('sales.invoices.detail.status.saving', 'Saving…')
                  : t('sales.invoices.detail.status.update', 'Update status')}
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {invoice.orderId ? (
                <Button asChild variant="outline">
                  <Link href={`/backend/sales/orders/${invoice.orderId}?kind=order`}>
                    {t('sales.invoices.detail.sourceOrder', 'Source order')}
                  </Link>
                </Button>
              ) : null}
              <Button type="button" variant="destructive" onClick={() => void handleDelete()}>
                <Trash2 className="mr-2 h-4 w-4" aria-hidden />
                {t('sales.invoices.delete.action', 'Delete invoice')}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border p-4">
            <div className="text-xs font-medium text-muted-foreground">{t('sales.invoices.table.issueDate', 'Issue date')}</div>
            <div className="mt-1 text-sm font-medium">{formatInvoiceDate(invoice.issueDate) || t('sales.invoices.notSet', 'Not set')}</div>
          </div>
          <div className="rounded-md border p-4">
            <div className="text-xs font-medium text-muted-foreground">{t('sales.invoices.table.dueDateHeader', 'Due date')}</div>
            <div className="mt-1 text-sm font-medium">{formatInvoiceDate(invoice.dueDate) || t('sales.invoices.notSet', 'Not set')}</div>
          </div>
          <div className="rounded-md border p-4">
            <div className="text-xs font-medium text-muted-foreground">{t('sales.invoices.table.total', 'Total')}</div>
            <div className="mt-1 text-sm font-medium">{formatInvoiceMoney(amount(invoice.grandTotalGrossAmount), currency)}</div>
          </div>
          <div className="rounded-md border p-4">
            <div className="text-xs font-medium text-muted-foreground">{t('sales.invoices.table.outstanding', 'Outstanding')}</div>
            <div className="mt-1 text-sm font-medium">{formatInvoiceMoney(amount(invoice.outstandingAmount), currency)}</div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <div className="min-w-[760px]">
            <div className="grid grid-cols-[64px_minmax(0,1fr)_120px_140px_140px] gap-3 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
              <div>{t('sales.invoices.detail.lines.number', 'No.')}</div>
              <div>{t('sales.invoices.detail.lines.item', 'Item')}</div>
              <div className="text-right">{t('sales.invoices.detail.lines.quantity', 'Quantity')}</div>
              <div className="text-right">{t('sales.invoices.detail.lines.unitPrice', 'Unit price')}</div>
              <div className="text-right">{t('sales.invoices.detail.lines.total', 'Total')}</div>
            </div>
            {lines.length ? (
              <div className="divide-y">
                {lines.map((line) => (
                  <div key={line.id} className="grid grid-cols-[64px_minmax(0,1fr)_120px_140px_140px] items-center gap-3 px-4 py-3">
                    <div className="text-sm text-muted-foreground">{line.lineNumber}</div>
                    <div className="min-w-0">
                      <div className="break-words text-sm font-medium">{line.name ?? line.sku ?? line.id}</div>
                      {line.description ? <div className="mt-1 break-words text-xs text-muted-foreground">{line.description}</div> : null}
                    </div>
                    <div className="whitespace-nowrap text-right text-sm">
                      {amount(line.quantity)} {line.quantityUnit ?? ''}
                    </div>
                    <div className="whitespace-nowrap text-right text-sm">
                      {formatInvoiceMoney(amount(line.unitPriceGross || line.unitPriceNet), currency)}
                    </div>
                    <div className="whitespace-nowrap text-right text-sm font-medium">
                      {formatInvoiceMoney(amount(line.totalGrossAmount || line.totalNetAmount), currency)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <TabEmptyState
                title={t('sales.invoices.detail.lines.emptyTitle', 'No invoice lines.')}
                description={t('sales.invoices.detail.lines.emptyDescription', 'Invoice line items will appear here.')}
              />
            )}
          </div>
        </div>

        <div className="ml-auto w-full max-w-sm rounded-md border p-4">
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{t('sales.invoices.detail.totals.subtotalNet', 'Subtotal net')}</span>
              <span>{formatInvoiceMoney(amount(invoice.subtotalNetAmount), currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{t('sales.invoices.detail.totals.tax', 'Tax')}</span>
              <span>{formatInvoiceMoney(amount(invoice.taxTotalAmount), currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{t('sales.invoices.detail.totals.discount', 'Discount')}</span>
              <span>{formatInvoiceMoney(amount(invoice.discountTotalAmount), currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-t pt-2 font-semibold">
              <span>{t('sales.invoices.detail.totals.grandTotal', 'Grand total')}</span>
              <span>{formatInvoiceMoney(amount(invoice.grandTotalGrossAmount), currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">{t('sales.invoices.detail.totals.paid', 'Paid')}</span>
              <span>{formatInvoiceMoney(amount(invoice.paidTotalAmount), currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 font-semibold">
              <span>{t('sales.invoices.detail.totals.outstanding', 'Outstanding')}</span>
              <span>{formatInvoiceMoney(amount(invoice.outstandingAmount), currency)}</span>
            </div>
          </div>
        </div>
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
