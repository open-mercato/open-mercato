"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage, TabEmptyState } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import type { SectionAction } from '@open-mercato/ui/backend/detail'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeDetail } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import { emitSalesDocumentTotalsRefresh } from '@open-mercato/core/modules/sales/lib/frontend/documentTotalsEvents'
import { PaymentDialog, type PaymentFormData, type PaymentTotals } from './PaymentDialog'

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
  customValues?: Record<string, unknown> | null
  customFieldSetId?: string | null
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

function toCustomValues(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const entries = raw as Record<string, unknown>
  return Object.keys(entries).length ? entries : null
}

function extractCustomValues(item: Record<string, unknown>): Record<string, unknown> | null {
  const direct = toCustomValues((item as any).customValues ?? (item as any).custom_values)
  if (direct) return direct
  const list =
    Array.isArray((item as any).customFields) && (item as any).customFields.length
      ? ((item as any).customFields as Array<Record<string, unknown>>)
      : Array.isArray((item as any).custom_fields) && (item as any).custom_fields.length
        ? ((item as any).custom_fields as Array<Record<string, unknown>>)
        : null
  if (!list) return null
  const mapped: Record<string, unknown> = {}
  list.forEach((entry) => {
    const key =
      typeof entry?.key === 'string'
        ? entry.key
        : typeof (entry as any)?.id === 'string'
          ? (entry as any).id
          : null
    if (!key) return
    const value = (entry as any)?.value
    mapped[key] = value
  })
  return Object.keys(mapped).length ? mapped : null
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
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [editingPayment, setEditingPayment] = React.useState<PaymentFormData | null>(null)

  const addActionLabel = t('sales.documents.payments.add', 'Add payment')
  const editActionLabel = t('sales.documents.payments.edit', 'Edit payment')
  const deleteActionLabel = t('sales.documents.payments.delete', 'Delete payment')

  const loadPayments = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '100', orderId })
      const response = await apiCall<{ items?: Array<Record<string, unknown>> }>(
        `/api/sales/payments?${params.toString()}`,
        undefined,
        { fallback: { items: [] } }
      )
      if (response.ok && Array.isArray(response.result?.items)) {
        const mapped = response.result.items.flatMap<PaymentRow>((item) => {
          if (typeof item.id !== 'string') return []
          const customValues =
            item && typeof item === 'object' ? extractCustomValues(item as Record<string, unknown>) : null
          const record: PaymentRow = {
            id: item.id,
            paymentReference: typeof item.payment_reference === 'string' ? item.payment_reference : null,
            paymentMethodId: typeof item.payment_method_id === 'string' ? item.payment_method_id : null,
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
            customValues,
            customFieldSetId:
              typeof (item as any)?.custom_field_set_id === 'string'
                ? (item as any).custom_field_set_id
                : typeof (item as any)?.customFieldSetId === 'string'
                  ? (item as any).customFieldSetId
                  : null,
          }
          return [record]
        })
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

  const openCreate = React.useCallback(() => {
    setEditingPayment(null)
    setDialogOpen(true)
  }, [])

  const handleDialogChange = React.useCallback((nextOpen: boolean) => {
    setDialogOpen(nextOpen)
    if (!nextOpen) {
      setEditingPayment(null)
    }
  }, [])

  const openEditPayment = React.useCallback(
    (record: PaymentRow) => {
      setEditingPayment({
        id: record.id,
        amount: record.amount ?? '',
        paymentMethodId: record.paymentMethodId ?? '',
        paymentReference: record.paymentReference ?? '',
        receivedAt: record.receivedAt ? record.receivedAt.slice(0, 10) : '',
        currencyCode: record.currencyCode ?? currencyCode ?? null,
        customValues: record.customValues ?? null,
        customFieldSetId: record.customFieldSetId ?? null,
      })
      setDialogOpen(true)
    },
    [currencyCode]
  )

  const handlePaymentSaved = React.useCallback(
    async (totals?: PaymentTotals | null) => {
      if (totals && onTotalsChange) {
        onTotalsChange(totals)
      }
      await loadPayments()
      emitSalesDocumentTotalsRefresh({ documentId: orderId, kind: 'order' })
      handleDialogChange(false)
    },
    [handleDialogChange, loadPayments, onTotalsChange, orderId]
  )

  const handleDelete = React.useCallback(
    async (row: PaymentRow) => {
      try {
        const result = await deleteCrud<{ orderTotals?: PaymentTotals | null }>('sales/payments', {
          body: {
            id: row.id,
            orderId,
            organizationId: resolvedOrganizationId ?? undefined,
            tenantId: resolvedTenantId ?? undefined,
          },
          errorMessage: t('sales.documents.payments.errorDelete', 'Failed to delete payment.'),
        })
        if (result.ok) {
          const totals = result.result?.orderTotals ?? null
          if (totals && onTotalsChange) {
            onTotalsChange(totals)
          }
          flash(t('sales.documents.payments.deleted', 'Payment deleted.'), 'success')
          await loadPayments()
          emitSalesDocumentTotalsRefresh({ documentId: orderId, kind: 'order' })
        }
      } catch (err) {
        console.error('sales.payments.delete', err)
        flash(t('sales.documents.payments.errorDelete', 'Failed to delete payment.'), 'error')
      }
    },
    [loadPayments, onTotalsChange, orderId, resolvedOrganizationId, resolvedTenantId, t]
  )

  React.useEffect(() => {
    if (!onActionChange) return
    onActionChange({
      label: addActionLabel,
      onClick: openCreate,
      disabled: loading,
    })
    return () => onActionChange(null)
  }, [addActionLabel, loading, onActionChange, openCreate])

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
        cell: ({ row }) => {
          return (
            <RowActions
              items={[
                { label: editActionLabel, onSelect: () => openEditPayment(row.original) },
                {
                  label: deleteActionLabel,
                  destructive: true,
                  onSelect: () => void handleDelete(row.original),
                },
              ]}
            />
          )
        },
      },
    ],
    [currencyCode, deleteActionLabel, editActionLabel, handleDelete, openEditPayment, t]
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
        <DataTable<PaymentRow> columns={columns} data={payments} onRowClick={openEditPayment} />
      ) : (
        <TabEmptyState
          title={t('sales.documents.payments.emptyTitle', 'No payments yet.')}
          description={t(
            'sales.documents.payments.emptyDescription',
            'Track received payments to keep outstanding balances up to date.'
          )}
          actionLabel={addActionLabel}
          onAction={openCreate}
          disabled={loading}
        />
      )}

      <PaymentDialog
        open={dialogOpen}
        onOpenChange={handleDialogChange}
        mode={editingPayment ? 'edit' : 'create'}
        payment={editingPayment}
        currencyCode={editingPayment?.currencyCode ?? currencyCode}
        orderId={orderId}
        organizationId={resolvedOrganizationId}
        tenantId={resolvedTenantId}
        onSaved={handlePaymentSaved}
      />
    </div>
  )
}
