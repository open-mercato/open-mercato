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
  RENTAL_CLIENT_TYPE_FALLBACKS,
  RENTAL_CLIENT_TYPE_VALUES,
  RENTAL_DURATION_TYPE_FALLBACKS,
  RENTAL_DURATION_TYPE_VALUES,
  RENTAL_STATUS_FALLBACKS,
  RENTAL_STATUS_VALUES,
  RENTAL_TYPE_FALLBACKS,
  RENTAL_TYPE_VALUES,
} from '../lib/rentalEnums'
import { customerNameOf, formatRentalAmount, formatRentalDate, useCustomerOptions } from './rentalOptions'
import type { RentalDurationType, RentalStatus } from '../data/entities'

export const RESOURCE = 'vehicle_rentals/contracts'
export const CREATE_HREF = '/backend/rentals/contracts/create'
export const editHref = (id: string) => `/backend/rentals/contracts/${id}/edit`
export const detailHref = (id: string) => `/backend/rentals/contracts/${id}`
export const ENTITY_ID = 'vehicle_rentals:rental_contract'

const LIST_MUTATION_CONTEXT_ID = 'vehicle_rentals.contracts.list'
const INITIAL_FILTER_KEYS = ['status', 'rentalType', 'clientType', 'durationType', 'customerId', 'q']

export type RentalContractRow = {
  id: string
  rental_number: string
  status: RentalStatus
  rental_type: string
  client_type: string
  duration_type: RentalDurationType
  customer_id: string
  customer_snapshot?: Record<string, unknown> | null
  vehicle_id?: string | null
  vehicle_snapshot?: Record<string, unknown> | null
  driver_snapshot?: Record<string, unknown> | null
  start_at?: string | null
  end_at?: string | null
  odo_start_km?: number | null
  odo_end_km?: number | null
  usage_km?: number | null
  extra_km?: number | null
  rental_amount_net?: string | null
  extra_km_amount_net?: string | null
  total_net_amount?: string | null
  tax_amount?: string | null
  total_gross_amount?: string | null
  currency_code: string
  updated_at?: string | null
  updatedAt?: string | null
}

function buildListParams(values: FilterValues, page: number, sorting: SortingState): Record<string, string | number> {
  const first = sorting[0]
  const out: Record<string, string | number> = {
    page,
    pageSize: 50,
    sortField: first?.id ?? 'created_at',
    sortDir: first ? (first.desc ? 'desc' : 'asc') : 'desc',
  }
  for (const key of ['status', 'rentalType', 'clientType', 'durationType', 'customerId'] as const) {
    const value = values[key]
    if (typeof value === 'string' && value.trim().length) out[key] = value.trim()
  }
  const search = values.q
  if (typeof search === 'string' && search.trim().length) out.search = search.trim()
  return out
}

export default function RentalContractsTable() {
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
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'created_at', desc: true }])
  const [page, setPage] = React.useState(1)

  React.useEffect(() => {
    if (Object.keys(initialFilters).length === 0) return
    setValues(initialFilters)
    setPage(1)
  }, [initialFilters])

  const { options: customerOptions, byId } = useCustomerOptions()
  const params = React.useMemo(() => buildListParams(values, page, sorting), [page, sorting, values])

  const query = useQuery({
    queryKey: ['rental-contracts', params, scopeVersion],
    queryFn: () => fetchCrudList<RentalContractRow>(RESOURCE, params),
  })
  const data = query.data

  const cancelRental = React.useCallback(async (row: RentalContractRow) => {
    const confirmed = await confirm({
      title: t('vehicle_rentals.contracts.actions.cancel.confirm', 'Cancel this rental?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(row.updatedAt ?? row.updated_at ?? null),
          () => apiCallOrThrow('/api/vehicle_rentals/contracts/cancel', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: row.id }),
          }, { errorMessage: t('vehicle_rentals.errors.cancel_failed', 'Unable to cancel the rental.') }),
        ),
        mutationPayload: { operation: 'rentals.cancel', id: row.id, updatedAt: row.updatedAt ?? null },
        context: { formId: LIST_MUTATION_CONTEXT_ID, resourceKind: ENTITY_ID, resourceId: row.id, retryLastMutation },
      })
      flash(t('vehicle_rentals.contracts.actions.cancel.success', 'Rental cancelled.'), 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : t('vehicle_rentals.errors.cancel_failed', 'Unable to cancel the rental.'), 'error')
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<RentalContractRow>[]>(() => [
    {
      accessorKey: 'rental_number',
      header: t('vehicle_rentals.contracts.columns.number', 'Rental'),
      cell: ({ row }) => (
        <Link href={detailHref(row.original.id)} className="text-sm font-medium text-foreground underline-offset-4 hover:underline">
          {row.original.rental_number}
        </Link>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'customer',
      header: t('vehicle_rentals.contracts.columns.customer', 'Customer'),
      enableSorting: false,
      cell: ({ row }) => {
        const name = customerNameOf(row.original.customer_snapshot, '') || byId.get(row.original.customer_id)?.displayName || '—'
        return (
          <span className="flex min-w-0 flex-col">
            <span className="text-sm">{name}</span>
            <span className="text-xs text-muted-foreground">
              {t(`vehicle_rentals.client_type.${row.original.client_type}`, RENTAL_CLIENT_TYPE_FALLBACKS[row.original.client_type] ?? row.original.client_type)}
            </span>
          </span>
        )
      },
      meta: { priority: 2 },
    },
    {
      id: 'vehicle',
      header: t('vehicle_rentals.contracts.columns.vehicle', 'Vehicle'),
      enableSorting: false,
      cell: ({ row }) => {
        const snapshot = row.original.vehicle_snapshot
        if (!snapshot) return <span className="text-sm text-muted-foreground">—</span>
        const label = [snapshot.plateNumber, snapshot.make, snapshot.model].filter(Boolean).join(' ')
        return (
          <span className="flex min-w-0 flex-col">
            <span className="text-sm">{label || '—'}</span>
            <span className="text-xs text-muted-foreground">
              {t(`vehicle_rentals.rental_type.${row.original.rental_type}`, RENTAL_TYPE_FALLBACKS[row.original.rental_type] ?? row.original.rental_type)}
            </span>
          </span>
        )
      },
      meta: { priority: 2 },
    },
    {
      id: 'window',
      header: t('vehicle_rentals.contracts.columns.window', 'Period'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm">
          {[formatRentalDate(row.original.start_at, locale), formatRentalDate(row.original.end_at, locale)].join(' → ')}
        </span>
      ),
      meta: { priority: 2 },
    },
    {
      id: 'km',
      header: t('vehicle_rentals.contracts.columns.km', 'Mileage'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col text-sm">
          {(row.original.odo_start_km ?? row.original.odo_end_km) ? (
            <span>{`${row.original.odo_start_km ?? '—'} → ${row.original.odo_end_km ?? '—'}`}</span>
          ) : <span className="text-muted-foreground">—</span>}
          {row.original.extra_km ? (
            <span className="text-xs text-muted-foreground">
              {t('vehicle_rentals.contracts.columns.extraKm', 'extra {km} km', { km: row.original.extra_km })}
            </span>
          ) : null}
        </span>
      ),
      meta: { priority: 3 },
    },
    {
      id: 'total',
      header: t('vehicle_rentals.contracts.columns.total', 'Total (gross)'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-sm font-medium">{formatRentalAmount(row.original.total_gross_amount ?? '0', row.original.currency_code)}</span>
      ),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'status',
      header: t('vehicle_rentals.contracts.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = String(getValue() ?? '')
        return (
          <Badge variant="secondary">
            {t(`vehicle_rentals.status.${value}`, RENTAL_STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 1 },
    },
  ], [byId, locale, t])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('vehicle_rentals.contracts.error.load', 'Failed to load rentals.')}</div>
  }

  return (
    <>
      <DataTable
        title={t('vehicle_rentals.contracts.page.title', 'Vehicle rentals')}
        titleHeadingLevel={1}
        actions={(
          <Button asChild>
            <Link href={CREATE_HREF}>{t('vehicle_rentals.contracts.actions.create', 'New rental')}</Link>
          </Button>
        )}
        searchValue={typeof values.q === 'string' ? values.q : ''}
        onSearchChange={(next: string) => {
          setValues((prev) => ({ ...prev, q: next }))
          setPage(1)
        }}
        searchPlaceholder={t('vehicle_rentals.contracts.search.placeholder', 'Rental number or notes')}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'view', label: t('vehicle_rentals.contracts.actions.view', 'View'), href: detailHref(row.id) },
              ...(row.status === 'draft' || row.status === 'active'
                ? [{ id: 'edit', label: t('vehicle_rentals.contracts.actions.edit', 'Edit'), href: editHref(row.id) }]
                : []),
              ...(row.status === 'draft' || row.status === 'active'
                ? [{ id: 'cancel', label: t('vehicle_rentals.contracts.actions.cancel.label', 'Cancel'), destructive: true, onSelect: () => { void cancelRental(row) } }]
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
            label: t('vehicle_rentals.contracts.filters.status', 'Status'),
            type: 'select',
            options: RENTAL_STATUS_VALUES.map((value) => ({
              value,
              label: t(`vehicle_rentals.status.${value}`, RENTAL_STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'rentalType',
            label: t('vehicle_rentals.contracts.filters.rentalType', 'Rental type'),
            type: 'select',
            options: RENTAL_TYPE_VALUES.map((value) => ({
              value,
              label: t(`vehicle_rentals.rental_type.${value}`, RENTAL_TYPE_FALLBACKS[value]),
            })),
          },
          {
            id: 'clientType',
            label: t('vehicle_rentals.contracts.filters.clientType', 'Client type'),
            type: 'select',
            options: RENTAL_CLIENT_TYPE_VALUES.map((value) => ({
              value,
              label: t(`vehicle_rentals.client_type.${value}`, RENTAL_CLIENT_TYPE_FALLBACKS[value]),
            })),
          },
          {
            id: 'durationType',
            label: t('vehicle_rentals.contracts.filters.durationType', 'Billing period'),
            type: 'select',
            options: RENTAL_DURATION_TYPE_VALUES.map((value) => ({
              value,
              label: t(`vehicle_rentals.duration_type.${value}`, RENTAL_DURATION_TYPE_FALLBACKS[value]),
            })),
          },
          {
            id: 'customerId',
            label: t('vehicle_rentals.contracts.filters.customer', 'Customer'),
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
