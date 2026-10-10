"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import Link from 'next/link'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useDirection, useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useInitialFilters } from '../lib/useInitialFilters'
import {
  customerNameOf,
  formatFreightAmount,
  formatFreightDate,
  useCustomerOptions,
} from './freightOptions'

export const RESOURCE = 'freight_operations/orders'
export const CREATE_HREF = '/backend/freight/orders/create'
export const editHref = (id: string) => `/backend/freight/orders/${id}/edit`
export const detailHref = (id: string) => `/backend/freight/orders/${id}`
export const ENTITY_ID = 'freight_operations:freight_order'

const LIST_MUTATION_CONTEXT_ID = 'freight_operations.orders.list'

const INITIAL_FILTER_KEYS = ['status', 'customerId', 'q']

export type FreightOrderStatus =
  | 'draft' | 'confirmed' | 'assigned' | 'in_transit' | 'delivered' | 'completed' | 'invoiced' | 'cancelled'

export const ORDER_STATUS_VALUES: FreightOrderStatus[] = [
  'draft', 'confirmed', 'assigned', 'in_transit', 'delivered', 'completed', 'invoiced', 'cancelled',
]

export type FreightOrderRow = {
  id: string
  order_number: string
  status: FreightOrderStatus
  customer_id: string
  customer_snapshot?: Record<string, unknown> | null
  cargo_description: string
  pickup_location: string
  dropoff_location: string
  requested_pickup_at?: string | null
  truck_type_required?: string | null
  agreed_amount_net: string
  adjustment_amount_net?: string | null
  currency_code: string
  invoiced_at?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

const STATUS_FALLBACKS: Record<FreightOrderStatus, string> = {
  draft: 'Draft',
  confirmed: 'Confirmed',
  assigned: 'Assigned',
  in_transit: 'In transit',
  delivered: 'Delivered',
  completed: 'Completed',
  invoiced: 'Invoiced',
  cancelled: 'Cancelled',
}

const LABEL_MISSING = '—'

type IncrementalAction = 'confirm' | 'dispatch' | 'complete' | 'invoice' | 'cancel'

export default function FreightOrdersTable() {
  const t = useT()
  const locale = useLocale()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; resourceId?: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: LIST_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const initialFilters = useInitialFilters(INITIAL_FILTER_KEYS)
  const [values, setValues] = React.useState<FilterValues>(initialFilters)
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'requested_pickup_at', desc: true }])
  const [page, setPage] = React.useState(1)

  // The dashboard tiles arrive as `?status=…`; without this the link lands on an
  // unfiltered list that looks like it ignored the click.
  React.useEffect(() => {
    if (Object.keys(initialFilters).length === 0) return
    setValues(initialFilters)
    setPage(1)
  }, [initialFilters])

  const { options: customerOptions, byId } = useCustomerOptions()

  const statusFilter = typeof values.status === 'string' ? values.status : undefined
  const customerFilter = typeof values.customerId === 'string' ? values.customerId : undefined
  const searchValue = typeof values.q === 'string' ? values.q : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'requested_pickup_at',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (statusFilter) out.status = statusFilter
    if (customerFilter) out.customerId = customerFilter
    if (searchValue && searchValue.trim().length) out.search = searchValue.trim()
    return out
  }, [page, searchValue, sorting, statusFilter, customerFilter])

  const query = useQuery({
    queryKey: ['freight-orders', params, scopeVersion],
    queryFn: () => fetchCrudList<FreightOrderRow>(RESOURCE, params),
  })

  const data = query.data

  const runOrderAction = React.useCallback(async (row: FreightOrderRow, action: IncrementalAction) => {
    const confirmed = await confirm({
      title: t(`freight_operations.orders.actions.${action}.confirm`, {
        confirm: 'Confirm this order?',
        dispatch: 'Dispatch this order now?',
        complete: 'Mark this order as completed?',
        invoice: 'Issue a tax invoice for this order? This creates a sales invoice document.',
        cancel: 'Cancel this order?',
      }[action]),
    })
    if (!confirmed) return
    const successFallback = {
      confirm: 'Order confirmed.',
      dispatch: 'Order dispatched.',
      complete: 'Order completed.',
      invoice: 'Invoice issued.',
      cancel: 'Order cancelled.',
    }[action]
    const errorFallback = {
      confirm: 'Unable to confirm the order.',
      dispatch: 'Unable to dispatch the order.',
      complete: 'Unable to complete the order.',
      invoice: 'Unable to invoice the order.',
      cancel: 'Unable to cancel the order.',
    }[action]
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt ?? row.updated_at ?? null),
          () => apiCallOrThrow(`/api/freight_operations/orders/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: row.id }),
          }, { errorMessage: errorFallback }),
        ),
        mutationPayload: { operation: `orders.${action}`, id: row.id, updatedAt: row.updatedAt ?? null },
        context: {
          formId: LIST_MUTATION_CONTEXT_ID,
          resourceKind: ENTITY_ID,
          resourceId: row.id,
          retryLastMutation,
        },
      })
      flash(t(`freight_operations.orders.actions.${action}.success`, successFallback), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : errorFallback, 'error')
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<FreightOrderRow>[]>(() => [
    {
      accessorKey: 'order_number',
      header: t('freight_operations.orders.columns.number', 'Order'),
      cell: ({ row }) => (
        <Link href={detailHref(row.original.id)} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
          {row.original.order_number}
        </Link>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'customer',
      header: t('freight_operations.orders.columns.customer', 'Customer'),
      enableSorting: false,
      cell: ({ row }) => {
        const name = customerNameOf(row.original.customer_snapshot, '') || byId.get(row.original.customer_id)?.displayName || LABEL_MISSING
        return <span className="text-sm">{name}</span>
      },
      meta: { priority: 1 },
    },
    {
      id: 'lane',
      header: t('freight_operations.orders.columns.lane', 'Lane'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm">{[row.original.pickup_location, row.original.dropoff_location].filter(Boolean).join(' → ') || LABEL_MISSING}</span>
          <span className="truncate text-xs text-muted-foreground">{row.original.cargo_description}</span>
        </span>
      ),
      meta: { priority: 2, truncate: true, maxWidth: '22rem' },
    },
    {
      accessorKey: 'requested_pickup_at',
      header: t('freight_operations.orders.columns.requestedPickup', 'Requested pickup'),
      cell: ({ row }) => <span className="text-sm">{formatFreightDate(row.original.requested_pickup_at, locale)}</span>,
      meta: { priority: 2 },
    },
    {
      id: 'amount',
      header: t('freight_operations.orders.columns.amount', 'Amount (net)'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm font-medium">{formatFreightAmount(row.original.agreed_amount_net, row.original.currency_code)}</span>
      ),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'status',
      header: t('freight_operations.orders.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = getValue() as FreightOrderStatus
        return (
          <Badge variant="secondary">
            {t(`freight_operations.orders.status.${value}`, STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 2 },
    },
  ], [byId, locale, t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('freight_operations.orders.error.load', 'Failed to load orders.')}</div>
  }

  return (
    <>
      <DataTable
        title={t('freight_operations.orders.page.title', 'Freight orders')}
        titleHeadingLevel={1}
        actions={(
          <Button asChild>
            <Link href={CREATE_HREF}>{t('freight_operations.orders.actions.create', 'New order')}</Link>
          </Button>
        )}
        searchValue={searchValue}
        onSearchChange={(next: string) => {
          setValues((prev) => ({ ...prev, q: next }))
          setPage(1)
        }}
        searchPlaceholder={t('freight_operations.orders.search.placeholder', 'Order number, cargo, or location')}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'view', label: t('freight_operations.orders.actions.view', 'View'), href: detailHref(row.id) },
              ...(row.status === 'draft' || row.status === 'confirmed'
                ? [{ id: 'edit', label: t('freight_operations.orders.actions.edit', 'Edit'), href: editHref(row.id) }]
                : []),
              ...(row.status === 'draft'
                ? [{ id: 'confirm', label: t('freight_operations.orders.actions.confirm.label', 'Confirm'), onSelect: () => { void runOrderAction(row, 'confirm') } }]
                : []),
              ...(row.status === 'assigned'
                ? [{ id: 'dispatch', label: t('freight_operations.orders.actions.dispatch.label', 'Dispatch'), onSelect: () => { void runOrderAction(row, 'dispatch') } }]
                : []),
              ...(row.status === 'delivered'
                ? [{ id: 'complete', label: t('freight_operations.orders.actions.complete.label', 'Complete'), onSelect: () => { void runOrderAction(row, 'complete') } }]
                : []),
              ...(row.status === 'completed'
                ? [{ id: 'invoice', label: t('freight_operations.orders.actions.invoice.label', 'Issue invoice'), onSelect: () => { void runOrderAction(row, 'invoice') } }]
                : []),
              ...(row.status !== 'invoiced' && row.status !== 'cancelled'
                ? [{ id: 'cancel', label: t('freight_operations.orders.actions.cancel.label', 'Cancel'), onSelect: () => { void runOrderAction(row, 'cancel') } }]
                : []),
            ]}
          />
        )}
        columns={columns}
        data={data?.items ?? []}
        searchAlign={direction === 'rtl' ? 'left' : 'right'}
        filters={[
          {
            id: 'status',
            label: t('freight_operations.orders.filters.status', 'Status'),
            type: 'select',
            options: ORDER_STATUS_VALUES.map((value) => ({
              value,
              label: t(`freight_operations.orders.status.${value}`, STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'customerId',
            label: t('freight_operations.orders.filters.customer', 'Customer'),
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
        sortable
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next)
          setPage(1)
        }}
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
      {ConfirmDialogElement}
    </>
  )
}
