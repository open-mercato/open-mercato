"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { mapCrudServerErrorToFormErrors } from '@open-mercato/ui/backend/utils/serverErrors'
import type { SectionAction } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { CalendarRange, CreditCard, DollarSign, Plus } from 'lucide-react'
import { useOrganizationScopeDetail } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

type PaymentRow = {
  id: string
  paymentReference: string | null
  paymentMethodId: string | null
  paymentMethodName: string | null
  status: string | null
  amount: number
  currencyCode: string | null
  receivedAt: string | null
  createdAt: string | null
}

type PaymentTotals = {
  paidTotalAmount?: number | null
  refundedTotalAmount?: number | null
  outstandingAmount?: number | null
}

type PaymentFormState = {
  amount: string
  currencyCode: string
  paymentMethodId: string
  paymentReference: string
  receivedAt: string
}

type PaymentMethodOption = {
  id: string
  name: string
  code: string
}

type SalesDocumentPaymentsSectionProps = {
  orderId: string
  currencyCode: string | null | undefined
  organizationId?: string | null
  tenantId?: string | null
  onActionChange?: (action: SectionAction | null) => void
  onTotalsChange?: (totals: PaymentTotals) => void
}

const defaultForm = (currencyCode?: string | null): PaymentFormState => ({
  amount: '',
  currencyCode: currencyCode ?? '',
  paymentMethodId: '',
  paymentReference: '',
  receivedAt: '',
})

function normalizeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

function formatMoney(value: number, currency: string | null | undefined): string {
  if (!currency || currency.trim().length !== 3) return value.toFixed(2)
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
  } catch {
    return `${currency.toUpperCase()} ${value.toFixed(2)}`
  }
}

export function SalesDocumentPaymentsSection({
  orderId,
  currencyCode,
  organizationId: orgFromProps,
  tenantId: tenantFromProps,
  onActionChange,
  onTotalsChange,
}: SalesDocumentPaymentsSectionProps) {
  const t = useT()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const resolvedOrganizationId = orgFromProps ?? organizationId ?? null
  const resolvedTenantId = tenantFromProps ?? tenantId ?? null
  const [payments, setPayments] = React.useState<PaymentRow[]>([])
  const [paymentMethods, setPaymentMethods] = React.useState<PaymentMethodOption[]>([])
  const [loading, setLoading] = React.useState(false)
  const [methodsLoading, setMethodsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [form, setForm] = React.useState<PaymentFormState>(() => defaultForm(currencyCode))
  const [formErrors, setFormErrors] = React.useState<Record<string, string | undefined>>({})
  const [submitError, setSubmitError] = React.useState<string | null>(null)

  const addActionLabel = t('sales.documents.payments.add', 'Add payment')

  const loadPaymentMethods = React.useCallback(async () => {
    setMethodsLoading(true)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/payment-methods?${params.toString()}`,
        undefined,
        { fallback: { items: [] } }
      )
      if (response.ok && Array.isArray(response.result?.items)) {
        const options = response.result.items
          .map((item) => {
            const id = typeof item.id === 'string' ? item.id : null
            if (!id) return null
            const name = typeof item.name === 'string' ? item.name : null
            const code = typeof item.code === 'string' ? item.code : null
            return { id, name: name ?? code ?? id, code: code ?? id }
          })
          .filter((entry): entry is PaymentMethodOption => !!entry)
        setPaymentMethods(options)
      } else {
        setPaymentMethods([])
      }
    } catch (err) {
      console.error('sales.payments.methods.load', err)
    } finally {
      setMethodsLoading(false)
    }
  }, [])

  const loadPayments = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '200', orderId })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/payments?${params.toString()}`,
        undefined,
        { fallback: { items: [] } }
      )
      if (response.ok && Array.isArray(response.result?.items)) {
        const mapped: PaymentRow[] = response.result.items
          .map((item) => ({
            id: typeof item.id === 'string' ? item.id : null,
            paymentReference:
              typeof item.payment_reference === 'string' ? item.payment_reference : null,
            paymentMethodId:
              typeof item.payment_method_id === 'string' ? item.payment_method_id : null,
            paymentMethodName:
              typeof item.payment_method_name === 'string'
                ? item.payment_method_name
                : typeof item.payment_method_code === 'string'
                  ? item.payment_method_code
                  : null,
            status: typeof item.status === 'string' ? item.status : null,
            amount: normalizeNumber(item.amount),
            currencyCode:
              typeof item.currency_code === 'string'
                ? item.currency_code
                : typeof currencyCode === 'string'
                  ? currencyCode
                  : null,
            receivedAt: typeof item.received_at === 'string' ? item.received_at : null,
            createdAt: typeof item.created_at === 'string' ? item.created_at : null,
          }))
          .filter((entry): entry is PaymentRow => !!entry.id)
        setPayments(mapped)
      } else {
        setPayments([])
      }
    } catch (err) {
      console.error('sales.payments.list', err)
      setError(t('sales.documents.payments.errorLoad', 'Failed to load payments.'))
    } finally {
      setLoading(false)
    }
  }, [currencyCode, orderId, t])

  React.useEffect(() => {
    void loadPayments()
  }, [loadPayments])

  React.useEffect(() => {
    void loadPaymentMethods()
  }, [loadPaymentMethods])

  const resetForm = React.useCallback(() => {
    setForm(defaultForm(currencyCode))
    setFormErrors({})
    setSubmitError(null)
  }, [currencyCode])

  const openDialog = React.useCallback(() => {
    resetForm()
    setDialogOpen(true)
  }, [resetForm])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: addActionLabel,
      onClick: openDialog,
      disabled: saving,
    })
    return () => onActionChange(null)
  }, [addActionLabel, onActionChange, openDialog, saving])

  const validateForm = React.useCallback(() => {
    const errors: Record<string, string> = {}
    const amountValue = normalizeNumber(form.amount)
    if (amountValue <= 0) {
      errors.amount = t('sales.documents.payments.amountRequired', 'Enter a positive amount.')
    }
    const currency = form.currencyCode || currencyCode || ''
    if (!currency.trim().length) {
      errors.currencyCode = t('sales.documents.payments.currencyRequired', 'Currency is required.')
    }
    return errors
  }, [currencyCode, form.amount, form.currencyCode, t])

  const handleSubmit = React.useCallback(async () => {
    if (saving) return
    const errors = validateForm()
    setFormErrors(errors)
    if (Object.keys(errors).length) return
    setSaving(true)
    setSubmitError(null)
    try {
      const payload: Record<string, unknown> = {
        orderId,
        amount: normalizeNumber(form.amount),
        currencyCode: (form.currencyCode || currencyCode || '').toUpperCase(),
        paymentReference: form.paymentReference?.trim()?.length ? form.paymentReference.trim() : undefined,
        paymentMethodId: form.paymentMethodId || undefined,
        organizationId: resolvedOrganizationId ?? undefined,
        tenantId: resolvedTenantId ?? undefined,
      }
      if (form.receivedAt && form.receivedAt.trim().length) {
        payload.receivedAt = new Date(form.receivedAt)
      }
      const result = await createCrud('sales/payments', payload, {
        successMessage: t('sales.documents.payments.created', 'Payment recorded.'),
        errorMessage: t('sales.documents.payments.errorSave', 'Failed to save payment.'),
      })
      if (result.ok) {
        const totals = (result.result as any)?.orderTotals as PaymentTotals | undefined
        if (totals && onTotalsChange) {
          onTotalsChange(totals)
        }
        await loadPayments()
        setDialogOpen(false)
        resetForm()
      }
    } catch (err) {
      console.error('sales.payments.save', err)
      const mapped = mapCrudServerErrorToFormErrors(err)
      if (mapped.fieldErrors) {
        setFormErrors((prev) => ({ ...prev, ...mapped.fieldErrors }))
      }
      if (mapped.message) {
        setSubmitError(mapped.message)
      }
    } finally {
      setSaving(false)
    }
  }, [
    currencyCode,
    form.amount,
    form.currencyCode,
    form.paymentMethodId,
    form.paymentReference,
    form.receivedAt,
    loadPayments,
    onTotalsChange,
    orderId,
    resetForm,
    resolvedOrganizationId,
    resolvedTenantId,
    saving,
    t,
    validateForm,
  ])

  const paymentMethodOptions = React.useMemo(() => paymentMethods, [paymentMethods])

  const columns = React.useMemo<ColumnDef<PaymentRow>[]>(
    () => [
      {
        accessorKey: 'paymentReference',
        header: t('sales.documents.payments.reference', 'Reference'),
        cell: ({ row }) => row.original.paymentReference || '—',
      },
      {
        accessorKey: 'paymentMethodName',
        header: t('sales.documents.payments.method', 'Method'),
        cell: ({ row }) => row.original.paymentMethodName ?? '—',
      },
      {
        accessorKey: 'status',
        header: t('sales.documents.payments.status', 'Status'),
        cell: ({ row }) => row.original.status ?? '—',
      },
      {
        accessorKey: 'amount',
        header: t('sales.documents.payments.amount', 'Amount'),
        cell: ({ row }) => formatMoney(row.original.amount, row.original.currencyCode ?? currencyCode),
      },
      {
        accessorKey: 'receivedAt',
        header: t('sales.documents.payments.receivedAt', 'Received'),
        cell: ({ row }) =>
          row.original.receivedAt
            ? new Date(row.original.receivedAt).toLocaleDateString()
            : '—',
      },
      {
        accessorKey: 'createdAt',
        header: t('sales.documents.payments.createdAt', 'Created'),
        cell: ({ row }) =>
          row.original.createdAt ? new Date(row.original.createdAt).toLocaleString() : '—',
      },
    ],
    [currencyCode, t]
  )

  if (loading) {
    return (
      <LoadingMessage
        label={t('sales.documents.payments.loading', 'Loading payments…')}
        className="min-w-[280px]"
      />
    )
  }

  if (error) {
    return (
      <ErrorMessage
        label={error}
        action={
          <Button variant="outline" size="sm" onClick={() => void loadPayments()}>
            {t('sales.documents.payments.retry', 'Retry')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {payments.length ? (
        <DataTable<PaymentRow> columns={columns} data={payments} />
      ) : (
        <TabEmptyState
          title={t('sales.documents.payments.emptyTitle', 'No payments yet.')}
          description={t(
            'sales.documents.payments.emptyDescription',
            'Track received payments to keep outstanding balances up to date.'
          )}
          actionLabel={addActionLabel}
          onAction={() => openDialog()}
        />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setDialogOpen(false)
            }
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void handleSubmit()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{addActionLabel}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="payment-amount" className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-muted-foreground" />
                {t('sales.documents.payments.amount', 'Amount')}
              </Label>
              <Input
                id="payment-amount"
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(evt) => setForm((prev) => ({ ...prev, amount: evt.target.value }))}
                placeholder="0.00"
              />
              {formErrors.amount ? <p className="text-xs text-destructive">{formErrors.amount}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-currency">{t('sales.documents.payments.currency', 'Currency')}</Label>
              <Input
                id="payment-currency"
                value={form.currencyCode || currencyCode || ''}
                onChange={(evt) => setForm((prev) => ({ ...prev, currencyCode: evt.target.value.toUpperCase() }))}
                placeholder="USD"
                maxLength={3}
              />
              {formErrors.currencyCode ? <p className="text-xs text-destructive">{formErrors.currencyCode}</p> : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-method" className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                {t('sales.documents.payments.method', 'Method')}
              </Label>
              <LookupSelect
                value={form.paymentMethodId || null}
                onChange={(next) => setForm((prev) => ({ ...prev, paymentMethodId: next ?? '' }))}
                fetchItems={async (query) => {
                  const term = query?.trim().toLowerCase() ?? ''
                  return paymentMethodOptions
                    .filter(
                      (option) =>
                        !term.length ||
                        option.name.toLowerCase().includes(term) ||
                        option.code.toLowerCase().includes(term)
                    )
                    .map<LookupSelectItem>((option) => ({
                      id: option.id,
                      title: option.name,
                      subtitle: option.code,
                      icon: <CreditCard className="h-5 w-5 text-muted-foreground" />,
                    }))
                }}
                loadingLabel={t('sales.documents.payments.loadingMethods', 'Loading methods…')}
                emptyLabel={t('sales.documents.payments.methodsEmpty', 'No payment methods')}
                selectedHintLabel={(id) =>
                  t('sales.documents.payments.methodSelected', 'Selected method: {{id}}', { id })
                }
              />
              {methodsLoading ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5 animate-spin" />
                  {t('sales.documents.payments.loadingMethods', 'Loading methods…')}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-reference">{t('sales.documents.payments.reference', 'Reference')}</Label>
              <Input
                id="payment-reference"
                value={form.paymentReference}
                onChange={(evt) => setForm((prev) => ({ ...prev, paymentReference: evt.target.value }))}
                placeholder={t('sales.documents.payments.referencePlaceholder', 'External reference or note')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="payment-received" className="flex items-center gap-2">
                <CalendarRange className="h-4 w-4 text-muted-foreground" />
                {t('sales.documents.payments.receivedAt', 'Received at')}
              </Label>
              <Input
                id="payment-received"
                type="date"
                value={form.receivedAt}
                onChange={(evt) => setForm((prev) => ({ ...prev, receivedAt: evt.target.value }))}
              />
            </div>
            {submitError ? <p className="text-sm text-destructive">{submitError}</p> : null}
          </div>
          <DialogFooter className="flex flex-row items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {t('customers.people.detail.inline.saveShortcut')}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>
                {t('ui.detail.inline.cancel', 'Cancel')}
              </Button>
              <Button onClick={() => void handleSubmit()} disabled={saving}>
                {saving ? <Spinner className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                {addActionLabel}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
