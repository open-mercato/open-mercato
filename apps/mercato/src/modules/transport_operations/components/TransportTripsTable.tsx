"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useDirection, useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import Link from 'next/link'
import { useDriverOptions, useRouteOptions, useVehicleOptions } from './transportOptions'

export const RESOURCE = 'transport_operations/trips'
export const CREATE_HREF = '/backend/transport/trips/create'
export const editHref = (id: string) => `/backend/transport/trips/${id}/edit`
export const ENTITY_ID = 'transport_operations:transport_trip_schedule'

const LIST_MUTATION_CONTEXT_ID = 'transport_operations.trips.list'

export type TripStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'

export const TRIP_STATUS_VALUES: TripStatus[] = ['scheduled', 'in_progress', 'completed', 'cancelled']

export type TripRow = {
  id: string
  route_id: string
  vehicle_id: string
  driver_id: string
  scheduled_start_time: string
  scheduled_end_time: string
  actual_start_time?: string | null
  actual_end_time?: string | null
  status: TripStatus
  updated_at?: string | null
  updatedAt?: string | null
}

const STATUS_FALLBACKS: Record<TripStatus, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const LABEL_MISSING = '—'

/**
 * The context a row mutation hands to the injection spot, so a widget that blocks or audits the
 * transition can identify the record exactly as a form would.
 */
type TripMutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

/** Localized date + time, because a trip is read against a clock, not a calendar page. */
export function formatDateTime(value: string | null | undefined, locale?: string): string {
  if (!value) return LABEL_MISSING
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })
}

export default function TransportTripsTable() {
  const t = useT()
  const locale = useLocale()
  const direction = useDirection()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<TripMutationContext>({
    contextId: LIST_MUTATION_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [values, setValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'scheduled_start_time', desc: true }])
  const [page, setPage] = React.useState(1)

  const { labels: routeLabels, routes } = useRouteOptions()
  const { labels: vehicleLabels } = useVehicleOptions()
  const { labels: driverLabels } = useDriverOptions()

  const statusFilter = typeof values.status === 'string' ? values.status : undefined
  const routeFilter = typeof values.routeId === 'string' ? values.routeId : undefined

  const params = React.useMemo(() => {
    const out: Record<string, string | number> = {
      page,
      pageSize: 50,
      sortField: sorting[0]?.id ?? 'scheduled_start_time',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (statusFilter) out.status = statusFilter
    if (routeFilter) out.routeId = routeFilter
    return out
  }, [page, sorting, statusFilter, routeFilter])

  const query = useQuery({
    queryKey: ['transport-trips', params, scopeVersion],
    queryFn: () => fetchCrudList<TripRow>(RESOURCE, params),
  })

  const data = query.data

  const runTripAction = React.useCallback(async (row: TripRow, action: 'dispatch' | 'complete' | 'cancel') => {
    const confirmed = await confirm({
      title: action === 'dispatch'
        ? t('transport_operations.trips.dispatch.confirm', 'Start this trip now?')
        : action === 'complete'
          ? t('transport_operations.trips.complete.confirm', 'Mark this trip as completed?')
          : t('transport_operations.trips.cancel.confirm', 'Cancel this trip? Its driver is released if the trip is in progress.'),
    })
    if (!confirmed) return
    const successMessage = action === 'dispatch'
      ? t('transport_operations.trips.dispatch.success', 'Trip dispatched.')
      : action === 'complete'
        ? t('transport_operations.trips.complete.success', 'Trip completed.')
        : t('transport_operations.trips.cancel.success', 'Trip cancelled.')
    const errorFallback = action === 'dispatch'
      ? t('transport_operations.trips.dispatch.error', 'Unable to dispatch the trip.')
      : action === 'complete'
        ? t('transport_operations.trips.complete.error', 'Unable to complete the trip.')
        : t('transport_operations.trips.cancel.error', 'Unable to cancel the trip.')
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => apiCallOrThrow(`/api/transport_operations/trips/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        }, { errorMessage: errorFallback }),
        mutationPayload: { operation: `trips.${action}`, id: row.id, updatedAt: row.updatedAt ?? null },
        context: {
          formId: LIST_MUTATION_CONTEXT_ID,
          resourceKind: ENTITY_ID,
          resourceId: row.id,
          retryLastMutation,
        },
      })
      flash(successMessage, 'success')
      await query.refetch()
    } catch (error) {
      flash(error instanceof Error && error.message ? error.message : errorFallback, 'error')
    }
  }, [confirm, query, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<TripRow>[]>(() => [
    {
      id: 'route',
      header: t('transport_operations.trips.columns.route', 'Route'),
      cell: ({ row }) => (
        <span className="text-sm font-medium">{routeLabels.get(row.original.route_id) ?? LABEL_MISSING}</span>
      ),
      meta: { priority: 1 },
    },
    {
      id: 'vehicle',
      header: t('transport_operations.trips.columns.vehicle', 'Vehicle'),
      enableSorting: false,
      cell: ({ row }) => <span className="text-sm">{vehicleLabels.get(row.original.vehicle_id) ?? LABEL_MISSING}</span>,
      meta: { priority: 2 },
    },
    {
      id: 'driver',
      header: t('transport_operations.trips.columns.driver', 'Driver'),
      enableSorting: false,
      cell: ({ row }) => <span className="text-sm">{driverLabels.get(row.original.driver_id) ?? LABEL_MISSING}</span>,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'scheduled_start_time',
      header: t('transport_operations.trips.columns.scheduledStart', 'Scheduled start'),
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm">{formatDateTime(row.original.scheduled_start_time, locale)}</span>
          <span className="text-xs text-muted-foreground">
            {`${t('transport_operations.trips.columns.scheduledEnd', 'Scheduled end')}: ${formatDateTime(row.original.scheduled_end_time, locale)}`}
          </span>
        </span>
      ),
      meta: { priority: 1 },
    },
    {
      accessorKey: 'status',
      header: t('transport_operations.trips.columns.status', 'Status'),
      cell: ({ getValue }) => {
        const value = getValue() as TripStatus
        return (
          <Badge variant="secondary">
            {t(`transport_operations.trips.status.${value}`, STATUS_FALLBACKS[value] ?? value)}
          </Badge>
        )
      },
      meta: { priority: 2 },
    },
  ], [driverLabels, locale, routeLabels, t, vehicleLabels])

  if (query.isError) {
    return <div className="text-sm text-destructive">{t('transport_operations.trips.error.load', 'Failed to load trips.')}</div>
  }

  return (
    <>
      <DataTable
        title={t('transport_operations.trips.page.title', 'Trips')}
        titleHeadingLevel={1}
        actions={(
          <Button asChild>
            <Link href={CREATE_HREF}>{t('transport_operations.trips.actions.create', 'Schedule trip')}</Link>
          </Button>
        )}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('transport_operations.trips.actions.edit', 'Edit'), href: editHref(row.id) },
              ...(row.status === 'scheduled'
                ? [{
                    id: 'dispatch',
                    label: t('transport_operations.trips.actions.dispatch', 'Dispatch'),
                    onSelect: () => { void runTripAction(row, 'dispatch') },
                  }]
                : []),
              ...(row.status === 'in_progress'
                ? [{
                    id: 'complete',
                    label: t('transport_operations.trips.actions.complete', 'Complete'),
                    onSelect: () => { void runTripAction(row, 'complete') },
                  }]
                : []),
              ...(row.status === 'scheduled' || row.status === 'in_progress'
                ? [{
                    id: 'cancel',
                    label: t('transport_operations.trips.actions.cancel', 'Cancel trip'),
                    destructive: true,
                    onSelect: () => { void runTripAction(row, 'cancel') },
                  }]
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
            label: t('transport_operations.trips.filters.status', 'Status'),
            type: 'select',
            options: TRIP_STATUS_VALUES.map((value) => ({
              value,
              label: t(`transport_operations.trips.status.${value}`, STATUS_FALLBACKS[value]),
            })),
          },
          {
            id: 'routeId',
            label: t('transport_operations.trips.filters.route', 'Route'),
            type: 'select',
            options: routes.map((route) => ({
              value: route.id,
              label: `${route.code} · ${route.name}`,
            })),
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
