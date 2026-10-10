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
import { buildTripListParams } from '../lib/listParams'
import { useInitialFilters } from '../lib/useInitialFilters'
import {
  canEditTrip,
  canExcludeTrip,
  isTripActionAllowed,
  type TripAction,
} from '../lib/actionGates'
import {
  TRIP_BILLING_STATUS_FALLBACKS,
  TRIP_BILLING_STATUS_VALUES,
  TRIP_EXECUTION_STATUS_FALLBACKS,
  TRIP_EXECUTION_STATUS_VALUES,
} from '../lib/freightEnums'
import { customerNameOf, formatFreightAmount, formatFreightDate, useCustomerOptions } from './freightOptions'
import { TripDeliverDialog } from './TripDeliverDialog'
import { TripChargesDialog } from './TripChargesDialog'
import type { TripBillingStatus, TripExecutionStatus } from '../data/entities'

export const RESOURCE = 'freight_operations/trips'
export const CREATE_HREF = '/backend/freight/trips/create'
export const editHref = (id: string) => `/backend/freight/trips/${id}/edit`
export const detailHref = (id: string) => `/backend/freight/trips/${id}`
export const ENTITY_ID = 'freight_operations:freight_trip'

const LIST_MUTATION_CONTEXT_ID = 'freight_operations.trips.list'

const INITIAL_FILTER_KEYS = ['contractId', 'customerId', 'executionStatus', 'billingStatus', 'q']

export type FreightTripRow = {
  id: string
  trip_number: string
  source: string
  contract_id?: string | null
  freight_order_id?: string | null
  customer_id: string
  customer_snapshot?: Record<string, unknown> | null
  execution_date?: string | null
  origin: string
  destination: string
  rate_basis?: string | null
  quantity?: string | null
  unit_price_net?: string | null
  base_amount_net?: string | null
  charges_total_net?: string | null
  total_net_amount: string
  tax_amount: string
  total_gross_amount: string
  currency_code: string
  execution_status: TripExecutionStatus
  billing_status: TripBillingStatus
  active_abstract_id?: string | null
  pod_reference?: string | null
  updated_at?: string | null
  updatedAt?: string | null
}

const LABEL_MISSING = '—'

const ACTION_LABEL_FALLBACKS: Record<TripAction | 'exclude', string> = {
  dispatch: 'Dispatch',
  start: 'Start',
  deliver: 'Record delivery',
  cancel: 'Cancel',
  exclude: 'Exclude from billing',
}

const ACTION_CONFIRM_FALLBACKS: Record<TripAction | 'exclude', string> = {
  dispatch: 'Dispatch this trip?',
  start: 'Start this trip now?',
  deliver: 'Record the delivery of this trip?',
  cancel: 'Cancel this trip?',
  exclude: 'Exclude this trip from billing? It will never be billed.',
}

const ACTION_SUCCESS_FALLBACKS: Record<TripAction | 'exclude', string> = {
  dispatch: 'Trip dispatched.',
  start: 'Trip started.',
  deliver: 'Delivery recorded.',
  cancel: 'Trip cancelled.',
  exclude: 'Trip excluded from billing.',
}

const ACTION_ERROR_FALLBACKS: Record<TripAction | 'exclude', string> = {
  dispatch: 'Unable to dispatch the trip.',
  start: 'Unable to start the trip.',
  deliver: 'Unable to record the delivery.',
  cancel: 'Unable to cancel the trip.',
  exclude: 'Unable to exclude the trip.',
}

export default function FreightTripsTable() {
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
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'execution_date', desc: true }])
  const [page, setPage] = React.useState(1)
  const [deliverTarget, setDeliverTarget] = React.useState<FreightTripRow | null>(null)
  const [chargesTarget, setChargesTarget] = React.useState<FreightTripRow | null>(null)

  React.useEffect(() => {
    if (Object.keys(initialFilters).length === 0) return
    setValues(initialFilters)
    setPage(1)
  }, [initialFilters])

  const { options: customerOptions, byId } = useCustomerOptions()
  const params = React.useMemo(() => buildTripListParams(values, page, sorting), [page, sorting, values])

  const query = useQuery({
    queryKey: ['freight-trips', params, scopeVersion],
    queryFn: () => fetchCrudList<FreightTripRow>(RESOURCE, params),
  })

  const data = query.data

  const runTripAction = React.useCallback(async (row: FreightTripRow, action: TripAction | 'exclude') => {
    const confirmed = await confirm({
      title: t(`freight_operations.trips.actions.${action}.confirm`, ACTION_CONFIRM_FALLBACKS[action]),
      variant: action === 'cancel' || action === 'exclude' ? 'destructive' : 'default',
    })
    if (!confirmed) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt ?? row.updated_at ?? null),
          () => apiCallOrThrow(`/api/freight_operations/trips/${action}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: row.id }),
          }, { errorMessage: ACTION_ERROR_FALLBACKS[action] }),
        ),
        mutationPayload: { operation: `trips.${action}`, id: row.id, updatedAt: row.updatedAt ?? null },
        context: { formId: LIST_MUTATION_CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: row.id, retryLastMutation },
      })
      flash(t(`freight_operations.trips.actions.${action}.success`, ACTION_SUCCESS_FALLBACKS[action]), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : ACTION_ERROR_FALLBACKS[action], 'error')
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<FreightTripRow>[]>(() => [
    {
      accessorKey: 'trip_number',
      header: t('freight_operations.trips.columns.number', 'Trip'),
      cell: ({ row }) => (
        <Link href={detailHref(row.original.id)} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
          {row.original.trip_number}
        </Link>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'customer',
      header: t('freight_operations.trips.columns.customer', 'Customer'),
      enableSorting: false,
      cell: ({ row }) => {
        const name = customerNameOf(row.original.customer_snapshot, '') || byId.get(row.original.customer_id)?.displayName || LABEL_MISSING
        return <span className="text-sm">{name}</span>
      },
      meta: { priority: 2 },
    },
    {
      id: 'lane',
      header: t('freight_operations.trips.columns.lane', 'Lane'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">{`${row.original.origin} → ${row.original.destination}`}</span>
      ),
      meta: { priority: 1, truncate: true, maxWidth: '20rem' },
    },
    {
      accessorKey: 'execution_date',
      header: t('freight_operations.trips.columns.executionDate', 'Executed'),
      cell: ({ row }) => <span className="text-sm">{formatFreightDate(row.original.execution_date, locale)}</span>,
      meta: { priority: 1 },
    },
    {
      id: 'amount',
      header: t('freight_operations.trips.columns.amount', 'Gross amount'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm font-medium">{formatFreightAmount(row.original.total_gross_amount, row.original.currency_code)}</span>
      ),
      meta: { priority: 2 },
    },
    {
      accessorKey: 'execution_status',
      header: t('freight_operations.trips.columns.executionStatus', 'Execution'),
      cell: ({ getValue }) => {
        const value = String(getValue() ?? '')
        return (
          <Badge variant="secondary">
            {t(`freight_operations.trips.execution_status.${value}`, TRIP_EXECUTION_STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 1 },
    },
    {
      accessorKey: 'billing_status',
      header: t('freight_operations.trips.columns.billingStatus', 'Billing'),
      cell: ({ getValue }) => {
        const value = String(getValue() ?? '')
        return (
          <Badge variant="secondary">
            {t(`freight_operations.trips.billing_status.${value}`, TRIP_BILLING_STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 2 },
    },
  ], [byId, locale, t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('freight_operations.trips.error.load', 'Failed to load trips.')}</div>
  }

  return (
    <>
      <DataTable
        title={t('freight_operations.trips.page.title', 'Freight trips')}
        titleHeadingLevel={1}
        actions={(
          <Button asChild>
            <Link href={CREATE_HREF}>{t('freight_operations.trips.actions.create', 'Record trip')}</Link>
          </Button>
        )}
        searchValue={typeof values.q === 'string' ? values.q : ''}
        onSearchChange={(next: string) => {
          setValues((prev) => ({ ...prev, q: next }))
          setPage(1)
        }}
        searchPlaceholder={t('freight_operations.trips.search.placeholder', 'Trip number, origin, or destination')}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'view', label: t('freight_operations.trips.actions.view', 'View'), href: detailHref(row.id) },
              ...(canEditTrip(row.billing_status)
                ? [{ id: 'edit', label: t('freight_operations.trips.actions.edit', 'Edit'), href: editHref(row.id) }]
                : []),
              ...(isTripActionAllowed(row.execution_status, 'dispatch')
                ? [{ id: 'dispatch', label: t('freight_operations.trips.actions.dispatch.label', 'Dispatch'), onSelect: () => { void runTripAction(row, 'dispatch') } }]
                : []),
              ...(isTripActionAllowed(row.execution_status, 'start')
                ? [{ id: 'start', label: t('freight_operations.trips.actions.start.label', 'Start'), onSelect: () => { void runTripAction(row, 'start') } }]
                : []),
              ...(isTripActionAllowed(row.execution_status, 'deliver')
                ? [{ id: 'deliver', label: t('freight_operations.trips.actions.deliver.label', 'Record delivery'), onSelect: () => setDeliverTarget(row) }]
                : []),
              ...(canEditTrip(row.billing_status)
                ? [{ id: 'charges', label: t('freight_operations.trips.actions.charges.label', 'Edit charges'), onSelect: () => setChargesTarget(row) }]
                : []),
              ...(canExcludeTrip(row.billing_status)
                ? [{ id: 'exclude', label: t('freight_operations.trips.actions.exclude.label', 'Exclude from billing'), destructive: true, onSelect: () => { void runTripAction(row, 'exclude') } }]
                : []),
              ...(canEditTrip(row.billing_status) && isTripActionAllowed(row.execution_status, 'cancel')
                ? [{ id: 'cancel', label: t('freight_operations.trips.actions.cancel.label', 'Cancel'), destructive: true, onSelect: () => { void runTripAction(row, 'cancel') } }]
                : []),
            ]}
          />
        )}
        columns={columns}
        data={data?.items ?? []}
        searchAlign={direction === 'rtl' ? 'left' : 'right'}
        filters={[
          {
            id: 'executionStatus',
            label: t('freight_operations.trips.filters.executionStatus', 'Execution'),
            type: 'select',
            options: TRIP_EXECUTION_STATUS_VALUES.map((value) => ({
              value,
              label: t(`freight_operations.trips.execution_status.${value}`, TRIP_EXECUTION_STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'billingStatus',
            label: t('freight_operations.trips.filters.billingStatus', 'Billing'),
            type: 'select',
            options: TRIP_BILLING_STATUS_VALUES.map((value) => ({
              value,
              label: t(`freight_operations.trips.billing_status.${value}`, TRIP_BILLING_STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'customerId',
            label: t('freight_operations.trips.filters.customer', 'Customer'),
            type: 'select',
            options: customerOptions,
          },
          {
            id: 'executionRange',
            label: t('freight_operations.trips.filters.executionRange', 'Execution date'),
            type: 'dateRange',
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
      <TripDeliverDialog
        trip={deliverTarget}
        onOpenChange={(open) => { if (!open) setDeliverTarget(null) }}
        onDelivered={() => {
          setDeliverTarget(null)
          void query.refetch()
        }}
      />
      <TripChargesDialog
        trip={chargesTarget}
        onOpenChange={(open) => { if (!open) setChargesTarget(null) }}
        onSaved={() => {
          setChargesTarget(null)
          void query.refetch()
        }}
      />
      {ConfirmDialogElement}
    </>
  )
}
