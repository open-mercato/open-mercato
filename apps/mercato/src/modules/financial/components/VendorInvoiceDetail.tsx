'use client'

import * as React from 'react'
import Link from 'next/link'
import { PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useVendorOptions } from './apOptions'

const RESOURCE = 'financial/ap/invoices'
const LIST_HREF = '/backend/financial/payables/invoices'
const editHref = (id: string) => `${LIST_HREF}/${id}/edit`
const STATUS_LABELS: Record<string, string> = { draft: 'Draft', posted: 'Posted', paid: 'Paid', void: 'Void' }

type Invoice = {
  id: string
  vendor_id: string
  internal_number: string
  vendor_invoice_number?: string | null
  issue_date?: string | null
  due_date?: string | null
  currency_code: string
  subtotal_net_amount?: string | null
  tax_total_amount?: string | null
  grand_total_gross_amount?: string | null
  status: string
  notes?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

type Line = {
  id: string
  description: string
  quantity: string
  unit_price_net: string
  total_net_amount: string
  tax_amount: string
  total_gross_amount: string
  tax_code: string | null
}

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

export default function VendorInvoiceDetail({ id }: { id: string }) {
  const t = useT()
  const { labels } = useVendorOptions()
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: `financial.ap-invoice:${id}`,
    blockedMessage: t('financial.ap.invoices.errors.action', 'The action could not be completed.'),
  })
  const [invoice, setInvoice] = React.useState<Invoice | null>(null)
  const [lines, setLines] = React.useState<Line[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [isBusy, setIsBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const [invoices, lineResult] = await Promise.all([
        fetchCrudList<Invoice>(RESOURCE, { ids: id, pageSize: 1 }),
        apiCall<{ items?: Line[] }>(`/api/financial/ap/invoices/lines?id=${id}`),
      ])
      const found = invoices?.items?.[0]
      if (!found) { setNotFound(true); return }
      setInvoice(found)
      setLines(lineResult.ok ? (lineResult.result?.items ?? []) : [])
    } catch {
      setError(t('financial.ap.invoices.form.error.load', 'Could not load the vendor invoice.'))
    } finally {
      setIsLoading(false)
    }
  }, [id, t])

  React.useEffect(() => { void load() }, [load])

  const runAction = async (action: 'post' | 'void') => {
    if (!invoice || isBusy) return
    setIsBusy(true)
    try {
      const call = await runMutation({
        operation: () => withScopedApiRequestHeaders(buildOptimisticLockHeader(invoice.updatedAt ?? invoice.updated_at ?? null), () =>
          apiCallOrThrow<{ id: string }>(`/api/financial/ap/invoices/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id }),
          })),
        context: {
          formId: `financial.ap-invoice:${id}`,
          resourceKind: 'financial:ap_vendor_invoice',
          resourceId: id,
          retryLastMutation,
        },
        mutationPayload: { id },
      })
      if (call.result) {
        flash(t(`financial.ap.invoices.messages.${action}`, action === 'post' ? 'Vendor invoice posted.' : 'Vendor invoice voided.'), 'success')
        await load()
      }
    } catch {
      flash(t('financial.ap.invoices.errors.action', 'The action could not be completed.'), 'error')
    } finally {
      setIsBusy(false)
    }
  }

  if (isLoading) return <LoadingMessage label={t('financial.ap.invoices.form.loading', 'Loading vendor invoice…')} />
  if (notFound) return <RecordNotFoundState label={t('financial.ap.invoices.form.error.notFound', 'Vendor invoice not found.')} backHref={LIST_HREF} backLabel={t('financial.ap.invoices.actions.back', 'Back to invoices')} />
  if (error) return <ErrorMessage label={error} />
  if (!invoice) return null

  return (
    <>
      <PageHeader
        title={invoice.internal_number}
        description={labels.get(invoice.vendor_id) ?? invoice.vendor_id}
        actions={(
          <div className="flex items-center gap-2">
            <Badge variant={invoice.status === 'void' ? 'secondary' : invoice.status === 'draft' ? 'outline' : 'default'}>
              {t(`financial.ap.invoices.status.${invoice.status}`, STATUS_LABELS[invoice.status] ?? invoice.status)}
            </Badge>
            {invoice.status === 'draft' ? (
              <>
                <Button asChild variant="outline"><Link href={editHref(id)}>{t('financial.ap.invoices.actions.edit', 'Edit')}</Link></Button>
                <Button type="button" onClick={() => void runAction('post')} disabled={isBusy}>
                  {t('financial.ap.invoices.actions.post', 'Post')}
                </Button>
              </>
            ) : null}
            {invoice.status === 'posted' ? (
              <Button type="button" variant="outline" onClick={() => void runAction('void')} disabled={isBusy}>
                {t('financial.ap.invoices.actions.void', 'Void')}
              </Button>
            ) : null}
          </div>
        )}
      />
      <PageBody>
        <Link className="text-sm text-muted-foreground underline" href={LIST_HREF}>
          {t('financial.ap.invoices.actions.back', 'Back to invoices')}
        </Link>
        <dl className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-4">
          <Field label={t('financial.ap.invoices.columns.issueDate', 'Issued')} value={(invoice.issue_date ?? '').slice(0, 10) || '—'} />
          <Field label={t('financial.ap.invoices.columns.dueDate', 'Due')} value={(invoice.due_date ?? '').slice(0, 10) || '—'} />
          <Field label={t('financial.ap.invoices.columns.total', 'Total')} value={`${invoice.grand_total_gross_amount ?? '0'} ${invoice.currency_code}`} />
          <Field label={t('financial.ap.invoices.form.vendorInvoiceNumber', 'Vendor invoice number')} value={invoice.vendor_invoice_number ?? '—'} />
        </dl>
        <Card>
          <CardHeader><CardTitle>{t('financial.ap.invoices.detail.lines', 'Lines')}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-start text-xs text-muted-foreground">
                  <th className="py-2 pe-3">{t('financial.ap.invoices.form.lines.description', 'Description')}</th>
                  <th className="py-2 pe-3 text-end">{t('financial.ap.invoices.form.lines.quantity', 'Qty')}</th>
                  <th className="py-2 pe-3 text-end">{t('financial.ap.invoices.form.lines.unitPrice', 'Unit price')}</th>
                  <th className="py-2 pe-3 text-end">{t('financial.ap.invoices.detail.net', 'Net')}</th>
                  <th className="py-2 pe-3 text-end">{t('financial.ap.invoices.detail.tax', 'Tax')}</th>
                  <th className="py-2 text-end">{t('financial.ap.invoices.detail.gross', 'Gross')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.id} className="border-b border-border/60">
                    <td className="py-2 pe-3">{line.description}</td>
                    <td className="py-2 pe-3 text-end">{line.quantity}</td>
                    <td className="py-2 pe-3 text-end">{line.unit_price_net}</td>
                    <td className="py-2 pe-3 text-end">{line.total_net_amount}</td>
                    <td className="py-2 pe-3 text-end">{line.tax_amount}</td>
                    <td className="py-2 text-end">{line.total_gross_amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
              <Field label={t('financial.ap.invoices.detail.subtotal', 'Net total')} value={invoice.subtotal_net_amount ?? '0'} />
              <Field label={t('financial.ap.invoices.detail.taxTotal', 'Tax total')} value={invoice.tax_total_amount ?? '0'} />
              <Field label={t('financial.ap.invoices.detail.grandTotal', 'Gross total')} value={invoice.grand_total_gross_amount ?? '0'} />
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}
