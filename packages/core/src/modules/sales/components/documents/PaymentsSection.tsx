"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import type { SectionAction } from '@open-mercato/ui/backend/detail'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { CreditCard } from 'lucide-react'
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
  const [formResetKey, setFormResetKey] = React.useState(0)
  const dialogContentRef = React.useRef<HTMLDivElement | null>(null)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [initialValues, setInitialValues] = React.useState<Record<string, unknown>>({
    amount: '',
    paymentMethodId: '',
    paymentReference: '',
    receivedAt: '',
  })

  const addActionLabel = t('sales.documents.payments.add', 'Add payment')
  const editActionLabel = t('sales.documents.payments.edit', 'Edit payment')
  const shortcutLabel = t('sales.documents.payments.saveShortcut', 'Save ⌘/Ctrl + S')

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
    setFormResetKey((prev) => prev + 1)
    setEditingId(null)
    setInitialValues({
      amount: '',
      paymentMethodId: '',
      paymentReference: '',
      receivedAt: '',
    })
  }, [])

  const openDialog = React.useCallback(() => {
    resetForm()
    setDialogOpen(true)
  }, [resetForm])

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: addActionLabel,
      onClick: openDialog,
      disabled: false,
    })
    return () => onActionChange(null)
  }, [addActionLabel, onActionChange, openDialog])

  const currencyLabel = React.useMemo(() => {
    const code = currencyCode ? currencyCode.toUpperCase() : ''
    if (!code) return t('sales.documents.detail.empty', 'Not set')
    return code
  }, [currencyCode, t])

  const fields = React.useMemo<CrudField[]>(
    () => [
      {
        id: 'amount',
        label: t('sales.documents.payments.amount', 'Amount'),
        type: 'number',
        placeholder: '0.00',
        required: true,
      },
      {
        id: 'paymentMethodId',
        label: t('sales.documents.payments.method', 'Method'),
        type: 'custom',
        component: ({ value, setValue }) => {
          const currentValue = typeof value === 'string' && value.length ? value : null
          const fetchItems = async (query?: string): Promise<LookupSelectItem[]> => {
            if (!paymentMethodOptions.length) {
              await loadPaymentMethods()
            }
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
                icon: <CreditCard className="h-4 w-4 text-muted-foreground" />,
              }))
          }
          return (
            <LookupSelect
              value={currentValue}
              onChange={(next) => setValue(next ?? '')}
              fetchItems={fetchItems}
              searchPlaceholder={t('sales.documents.payments.methodPlaceholder', 'Search payment method')}
              emptyLabel={t('sales.documents.payments.methodsEmpty', 'No payment methods')}
              loadingLabel={t('sales.documents.payments.loadingMethods', 'Loading payment methods…')}
              selectedHintLabel={(id) =>
                t('sales.documents.payments.methodSelected', 'Selected method: {{id}}', { id })
              }
              minQuery={0}
            />
          )
        },
      },
      {
        id: 'paymentReference',
        label: t('sales.documents.payments.reference', 'Reference'),
        type: 'text',
        placeholder: t('sales.documents.payments.referencePlaceholder', 'External reference or note'),
      },
      {
        id: 'receivedAt',
        label: t('sales.documents.payments.receivedAt', 'Received at'),
        type: 'date',
      },
      {
        id: 'currencyDisplay',
        label: t('sales.documents.payments.currency', 'Currency'),
        type: 'custom',
        component: () => <p className="text-sm text-muted-foreground">{currencyLabel}</p>,
      },
    ],
    [currencyLabel, loadPaymentMethods, paymentMethodOptions, t]
  )

  const handleFormSubmit = React.useCallback(
    async (values: Record<string, unknown>) => {
      const resolvedCurrency = currencyCode ? currencyCode.toUpperCase() : ''
      const amountValue = normalizeNumber(values.amount)
      if (!resolvedCurrency.trim()) {
        throw createCrudFormError(t('sales.documents.payments.currencyRequired', 'Currency is required.'))
      }
      if (amountValue <= 0) {
        throw createCrudFormError(t('sales.documents.payments.amountRequired', 'Enter a positive amount.'), {
          amount: t('sales.documents.payments.amountRequired', 'Enter a positive amount.'),
        })
      }
      const payload: Record<string, unknown> = {
        orderId,
        amount: amountValue,
        currencyCode: resolvedCurrency,
        paymentReference:
          typeof values.paymentReference === 'string' && values.paymentReference.trim().length
            ? values.paymentReference.trim()
            : undefined,
        paymentMethodId:
          typeof values.paymentMethodId === 'string' && values.paymentMethodId.trim().length
            ? values.paymentMethodId
            : undefined,
        organizationId: resolvedOrganizationId ?? undefined,
        tenantId: resolvedTenantId ?? undefined,
      }
      if (typeof values.receivedAt === 'string' && values.receivedAt.trim().length) {
        payload.receivedAt = new Date(values.receivedAt)
      }
      const action = editingId ? updateCrud : createCrud
      const result = await action(
        'sales/payments',
        editingId ? { id: editingId, ...payload } : payload,
        {
          successMessage: t('sales.documents.payments.created', 'Payment recorded.'),
          errorMessage: t('sales.documents.payments.errorSave', 'Failed to save payment.'),
        }
      )
      if (result.ok) {
        const totals = (result.result as any)?.orderTotals as PaymentTotals | undefined
        if (totals && onTotalsChange) {
          onTotalsChange(totals)
        }
        await loadPayments()
        setDialogOpen(false)
        resetForm()
      }
    },
    [
      currencyCode,
      editingId,
      loadPayments,
      onTotalsChange,
      orderId,
      resetForm,
      resolvedOrganizationId,
      resolvedTenantId,
      t,
    ]
  )

  const handleShortcutSubmit = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      const form = dialogContentRef.current?.querySelector('form')
      form?.requestSubmit()
    }
  }, [])

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
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <RowActions
            onEdit={() => {
              const record = row.original
              setEditingId(record.id)
              setInitialValues({
                amount: record.amount ?? '',
                paymentMethodId: record.paymentMethodId ?? '',
                paymentReference: record.paymentReference ?? '',
                receivedAt: record.receivedAt ? record.receivedAt.slice(0, 10) : '',
              })
              setDialogOpen(true)
            }}
            actions={[{ id: 'edit', label: editActionLabel }]}
          />
        ),
      },
    ],
    [currencyCode, editActionLabel, t]
  )

  if (loading) {
    return (
      <LoadingMessage
        label={t('sales.documents.payments.loading', 'Loading payments…')}
        className="border-0 bg-transparent p-0 py-8 justify-center"
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
          ref={dialogContentRef}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              setDialogOpen(false)
            }
            handleShortcutSubmit(event)
          }}
        >
          <DialogHeader>
            <DialogTitle>{editingId ? editActionLabel : addActionLabel}</DialogTitle>
          </DialogHeader>
          <CrudForm
            key={formResetKey}
            embedded
            fields={fields}
            initialValues={initialValues}
            submitLabel={`${editingId ? editActionLabel : addActionLabel} · ${shortcutLabel}`}
            onSubmit={handleFormSubmit}
            loadingMessage={t('sales.documents.payments.loading', 'Loading payments…')}
            contentHeader={
              methodsLoading ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Spinner className="h-3.5 w-3.5 animate-spin" />
                  {t('sales.documents.payments.loadingMethods', 'Loading payment methods…')}
                </p>
              ) : null
            }
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
