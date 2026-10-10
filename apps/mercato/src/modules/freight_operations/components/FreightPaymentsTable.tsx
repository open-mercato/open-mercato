"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import Link from 'next/link'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useDirection, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { buildPaymentListParams } from '../lib/listParams'
import { useInitialFilters } from '../lib/useInitialFilters'
import {
  PAYMENT_METHOD_FALLBACKS,
  PAYMENT_METHOD_VALUES,
  PAYMENT_STATUS_FALLBACKS,
  PAYMENT_STATUS_VALUES,
} from '../lib/freightEnums'
import { customerNameOf, formatFreightAmount, useCustomerOptions } from './freightOptions'
import { RecordPaymentDialog } from './RecordPaymentDialog'
import { VoidPaymentDialog, type VoidablePayment } from './VoidPaymentDialog'

const RESOURCE = 'freight_operations/payments'
const ENTITY_ID = 'freight_operations:freight_payment'
const CONTEXT_ID = 'freight_operations.payments.list'

const INITIAL_FILTER_KEYS = ['status', 'method', 'customerId', 'orderId', 'abstractId']

export type FreightPaymentListRow = VoidablePayment & {
  order_id?: string | null
  abstract_id?: string | null
  customer_id?: string | null
  customer_snapshot?: Record<string, unknown> | null
  currency_code: string
  method: string
  received_at: string
  status: string
  invoice_synced_at?: string | null
}

export default function FreightPaymentsTable() {
  const t = useT()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const initialFilters = useInitialFilters(INITIAL_FILTER_KEYS)
  const [values, setValues] = React.useState<FilterValues>(initialFilters)
  const [page, setPage] = React.useState(1)
  const [recordOpen, setRecordOpen] = React.useState(false)
  const [voidTarget, setVoidTarget] = React.useState<VoidablePayment | null>(null)

  React.useEffect(() => {
    if (Object.keys(initialFilters).length === 0) return
    setValues(initialFilters)
    setPage(1)
  }, [initialFilters])

  const { options: customerOptions, byId } = useCustomerOptions()
  const params = React.useMemo(() => buildPaymentListParams(values, page), [page, values])

  const query = useQuery({
    queryKey: ['freight-payments-list', params, scopeVersion],
    queryFn: () => fetchCrudList<FreightPaymentListRow>(RESOURCE, params),
  })
  const data = query.data

  const resync = React.useCallback(async (row: FreightPaymentListRow) => {
    const scope = row.order_id ? { orderId: row.order_id } : (row.abstract_id ? { abstractId: row.abstract_id } : null)
    if (!scope) {
      flash(t('freight_operations.errors.payment_target_missing', 'The invoiced document for this payment is no longer available.'), 'error')
      return
    }
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => apiCallOrThrow('/api/freight_operations/payments/resync', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(scope),
        }, { errorMessage: t('freight_operations.errors.payment_resync_failed', 'Unable to resync the invoice totals.') }),
        mutationPayload: { operation: 'payments.resync', ...scope },
        context: { formId: CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: row.id, retryLastMutation },
      })
      flash(t('freight_operations.payments.resync.success', 'Invoice totals synced.'), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t('freight_operations.errors.payment_resync_failed', 'Unable to resync the invoice totals.'), 'error')
    }
  }, [query, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<FreightPaymentListRow>[]>(() => [
    {
      accessorKey: 'received_at',
      header: t('freight_operations.payments.columns.receivedAt', 'Received'),
      cell: ({ row }) => <span className="text-sm">{row.original.received_at}</span>,
      meta: { priority: 1 },
    },
    {
      id: 'customer',
      header: t('freight_operations.payments.columns.customer', 'Customer'),
      enableSorting: false,
      cell: ({ row }) => {
        const name = customerNameOf(row.original.customer_snapshot, '')
          || (row.original.customer_id ? byId.get(row.original.customer_id)?.displayName : undefined)
          || '—'
        return <span className="text-sm">{name}</span>
      },
      meta: { priority: 2 },
    },
    {
      id: 'document',
      header: t('freight_operations.payments.columns.document', 'Document'),
      enableSorting: false,
      cell: ({ row }) => {
        const href = row.original.order_id
          ? `/backend/freight/orders/${row.original.order_id}`
          : row.original.abstract_id
            ? `/backend/freight/abstracts/${row.original.abstract_id}`
            : null
        const label = row.original.order_id
          ? t('freight_operations.payments.dialog.kindOrder', 'Spot order')
          : t('freight_operations.payments.dialog.kindAbstract', 'Trip abstract')
        return href ? (
          <Link href={href} className="text-sm text-foreground underline-offset-4 hover:underline">{label}</Link>
        ) : (
          <span className="text-sm">—</span>
        )
      },
      meta: { priority: 2 },
    },
    {
      id: 'amount',
      header: t('freight_operations.payments.columns.amount', 'Amount'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm font-medium">{formatFreightAmount(row.original.amount, row.original.currency_code)}</span>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'method',
      header: t('freight_operations.payments.columns.method', 'Method'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">
          {t(`freight_operations.payments.method.${row.original.method}`, PAYMENT_METHOD_FALLBACKS[row.original.method] ?? row.original.method)}
        </span>
      ),
      meta: { priority: 3 },
    },
    {
      id: 'reference',
      header: t('freight_operations.payments.columns.reference', 'Reference'),
      enableSorting: false,
      cell: ({ row }) => <span className="text-sm">{row.original.reference ?? '—'}</span>,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'status',
      header: t('freight_operations.payments.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = String(getValue() ?? '')
        return (
          <Badge variant="secondary">
            {t(`freight_operations.payments.status.${value}`, PAYMENT_STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 1 },
    },
  ], [byId, t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('freight_operations.errors.payments_load_failed', 'Failed to load payments.')}</div>
  }

  return (
    <>
      <DataTable
        title={t('freight_operations.payments.page.title', 'Freight payments')}
        titleHeadingLevel={1}
        actions={(
          <Button type="button" onClick={() => setRecordOpen(true)}>
            {t('freight_operations.payments.form.record', 'Record payment')}
          </Button>
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              ...(row.status === 'recorded'
                ? [{
                    id: 'void',
                    label: t('freight_operations.payments.void.action', 'Void'),
                    destructive: true,
                    onSelect: () => setVoidTarget(row),
                  }]
                : []),
              {
                id: 'resync',
                label: t('freight_operations.payments.resync.action', 'Resync invoice totals'),
                onSelect: () => { void resync(row) },
              },
            ]}
          />
        )}
        columns={columns}
        data={data?.items ?? []}
        searchAlign={direction === 'rtl' ? 'left' : 'right'}
        filters={[
          {
            id: 'status',
            label: t('freight_operations.payments.filters.status', 'Status'),
            type: 'select',
            options: PAYMENT_STATUS_VALUES.map((value) => ({
              value,
              label: t(`freight_operations.payments.status.${value}`, PAYMENT_STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'method',
            label: t('freight_operations.payments.filters.method', 'Method'),
            type: 'select',
            options: PAYMENT_METHOD_VALUES.map((value) => ({
              value,
              label: t(`freight_operations.payments.method.${value}`, PAYMENT_METHOD_FALLBACKS[value]),
            })),
          },
          {
            id: 'customerId',
            label: t('freight_operations.payments.filters.customer', 'Customer'),
            type: 'select',
            options: customerOptions,
          },
        ]}
        filterValues={values}
        onFiltersApply={(next: FilterValues) => {
          setValues(next)
          setPage(1)
        }}
        onFiltersClear={() => {
          setValues({})
          setPage(1)
        }}
        entityId={ENTITY_ID}
        pagination={{
          page,
          pageSize: 50,
          total: data?.total ?? 0,
          totalPages: data?.totalPages ?? 0,
          totalIsCapped: data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        isLoading={query.isLoading}
      />
      <RecordPaymentDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        onRecorded={() => {
          setRecordOpen(false)
          void query.refetch()
        }}
      />
      <VoidPaymentDialog
        payment={voidTarget}
        onOpenChange={(open) => { if (!open) setVoidTarget(null) }}
        onVoided={() => {
          setVoidTarget(null)
          void query.refetch()
        }}
      />
    </>
  )
}
