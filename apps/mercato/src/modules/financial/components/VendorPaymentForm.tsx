'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useVendorOptions } from './apOptions'

const LIST_HREF = '/backend/financial/payables/payments'

type WithholdingCategory = { code: string; label: string; rate: number }

type OpenInvoice = {
  id: string
  internal_number: string
  grand_total_gross_amount?: string | null
  currency_code: string
}

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

export default function VendorPaymentForm() {
  const t = useT()
  const router = useRouter()
  const { vendors } = useVendorOptions()
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: 'financial.ap-payment:create',
    blockedMessage: t('financial.ap.payments.errors.save', 'Unable to record the payment.'),
  })
  const [vendorId, setVendorId] = React.useState('')
  const [paymentDate, setPaymentDate] = React.useState(new Date().toISOString().slice(0, 10))
  const [currencyCode, setCurrencyCode] = React.useState('SAR')
  const [grossAmount, setGrossAmount] = React.useState('')
  const [withholdingCode, setWithholdingCode] = React.useState('')
  const [method, setMethod] = React.useState<'bank_transfer' | 'cheque' | 'cash'>('bank_transfer')
  const [reference, setReference] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [allocations, setAllocations] = React.useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = React.useState(false)

  const withholdingQuery = useQuery({
    queryKey: ['financial-ap-withholding-categories'],
    queryFn: () => apiCall<{ categories?: WithholdingCategory[] }>('/api/financial/ap/withholding-categories'),
    staleTime: 5 * 60 * 1000,
  })
  const categories = withholdingQuery.data?.result?.categories ?? []

  const invoicesQuery = useQuery({
    queryKey: ['financial-ap-open-invoices', vendorId],
    queryFn: () => fetchCrudList<OpenInvoice>('financial/ap/invoices', {
      vendorId,
      status: 'posted',
      pageSize: 100,
      sortField: 'dueDate',
      sortDir: 'asc',
    }),
    enabled: vendorId.length > 0,
  })
  const invoices = invoicesQuery.data?.items ?? []

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isSaving) return
    if (!vendorId || !grossAmount.trim()) {
      flash(t('financial.ap.payments.errors.required', 'Choose a vendor and enter an amount.'), 'error')
      return
    }
    setIsSaving(true)
    const payload = {
      vendorId,
      paymentDate,
      currencyCode: currencyCode.trim().toUpperCase(),
      grossAmount: grossAmount.trim(),
      withholdingCode: withholdingCode || null,
      method,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
      allocations: Object.entries(allocations)
        .filter(([, amount]) => Number(amount) > 0)
        .map(([invoiceId, amount]) => ({ invoiceId, amount })),
    }
    try {
      const call = await runMutation({
        operation: () => apiCallOrThrow('/api/financial/ap/payments/post', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        context: {
          formId: 'financial.ap-payment:create',
          resourceKind: 'financial:ap_payment',
          resourceId: vendorId,
          retryLastMutation,
        },
        mutationPayload: payload,
      })
      if (!call.result) {
        flash(t('financial.ap.payments.errors.save', 'Unable to record the payment.'), 'error')
        return
      }
      flash(t('financial.ap.payments.messages.saved', 'Payment recorded.'), 'success')
      router.push(LIST_HREF)
    } catch {
      flash(t('financial.ap.payments.errors.save', 'Unable to record the payment.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <PageHeader title={t('financial.ap.payments.form.title', 'Record a vendor payment')} />
      <PageBody>
        <form onSubmit={handleSubmit} className="grid max-w-3xl gap-6">
          <Card>
            <CardHeader><CardTitle>{t('financial.ap.payments.form.details', 'Payment')}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>{t('financial.ap.payments.form.vendor', 'Vendor')}</Label>
                <Select value={vendorId} onValueChange={setVendorId}>
                  <SelectTrigger><SelectValue placeholder={t('financial.ap.payments.form.vendorPlaceholder', 'Select a vendor')} /></SelectTrigger>
                  <SelectContent>
                    {vendors.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.code} — {vendor.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="payment-date">{t('financial.ap.payments.form.date', 'Payment date')}</Label>
                <Input id="payment-date" type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="payment-amount">{t('financial.ap.payments.form.amount', 'Gross amount')}</Label>
                <Input id="payment-amount" value={grossAmount} onChange={(event) => setGrossAmount(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="payment-currency">{t('financial.ap.payments.form.currency', 'Currency')}</Label>
                <Input id="payment-currency" value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>{t('financial.ap.payments.form.withholding', 'Withholding category')}</Label>
                <Select value={withholdingCode} onValueChange={setWithholdingCode}>
                  <SelectTrigger><SelectValue placeholder={t('financial.ap.payments.form.withholdingNone', 'No withholding')} /></SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.code} value={category.code}>
                        {category.label} ({Math.round(category.rate * 100)}%)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>{t('financial.ap.payments.form.method', 'Method')}</Label>
                <Select value={method} onValueChange={(value) => setMethod(value as typeof method)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">{t('financial.ap.payments.method.bank_transfer', 'Bank transfer')}</SelectItem>
                    <SelectItem value="cheque">{t('financial.ap.payments.method.cheque', 'Cheque')}</SelectItem>
                    <SelectItem value="cash">{t('financial.ap.payments.method.cash', 'Cash')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="payment-reference">{t('financial.ap.payments.form.reference', 'Reference')}</Label>
                <Input id="payment-reference" value={reference} onChange={(event) => setReference(event.target.value)} />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="payment-notes">{t('financial.ap.payments.form.notes', 'Notes')}</Label>
                <Input id="payment-notes" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t('financial.ap.payments.form.allocations', 'Allocate to invoices')}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {vendorId.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('financial.ap.payments.form.allocationsHint', 'Choose a vendor to see its open invoices.')}</p>
              ) : invoices.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('financial.ap.payments.form.allocationsEmpty', 'No posted invoices for this vendor.')}</p>
              ) : invoices.map((invoice) => (
                <div key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                  <span className="font-mono text-xs">{invoice.internal_number}</span>
                  <span className="text-sm text-muted-foreground">{invoice.grand_total_gross_amount ?? '0'} {invoice.currency_code}</span>
                  <Input
                    className="w-32"
                    value={allocations[invoice.id] ?? ''}
                    onChange={(event) => setAllocations((current) => ({ ...current, [invoice.id]: event.target.value }))}
                    placeholder="0.00"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={isSaving}>
              {isSaving ? <Spinner size="sm" /> : null}
              {t('financial.ap.payments.form.submit', 'Record payment')}
            </Button>
          </div>
        </form>
      </PageBody>
    </>
  )
}
