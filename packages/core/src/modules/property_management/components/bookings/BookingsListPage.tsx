"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { hasFeature } from '@open-mercato/shared/security/features'
import { GatedLink } from '../featureLinks'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { readErrorCode, readErrorMessage } from '../leases/leaseModel'
import { CrmHiddenNote } from '../CrmHiddenNote'
import { useBookingBuildingOptions } from './useBookingBuildingOptions'
import { useBookingsList } from './useBookingsList'
import { ALL_BOOKINGS_FILTER as ALL, BookingsToolbar } from './BookingsToolbar'
import {
  BOOKING_RESOURCE_KIND,
  BOOKING_STATE_FILTERS,
  BOOKINGS_MANAGE_FEATURE,
  bookingStatusLabel,
  bookingStatusBadge,
  canCancelBooking,
  formatBookedAs,
  formatBookingTime,
  isUuid,
  unitFilterLabel,
  type BookingSummary,
} from './bookingModel'

const PAGE_SIZE = 50
const UNITS_MANAGE_FEATURE = 'property_management.manage'
const STALE_CANCEL_CODES = new Set(['booking_already_ended', 'booking_not_cancellable'])

type MutationContext = { formId: string; resourceKind: string; resourceId: string; retryLastMutation: () => Promise<boolean> }

export function BookingsListPage() {
  const t = useT()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const bookingId = searchParams?.get('id') ?? null
  const urlUnitId = searchParams?.get('unitId') ?? null
  const unitId = isUuid(urlUnitId) ? urlUnitId : null
  const urlUnitName = searchParams?.get('unitName') ?? null
  const locale = useLocale()
  const scopeVersion = useOrganizationScopeVersion()
  const { payload: chrome } = useBackendChrome()
  const canManage = hasFeature(chrome?.grantedFeatures, BOOKINGS_MANAGE_FEATURE)
  const canEditUnits = hasFeature(chrome?.grantedFeatures, UNITS_MANAGE_FEATURE)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: 'property-management-bookings',
    blockedMessage: t('property_management.common.blocked', 'The change was blocked.'),
  })
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [chip, setChip] = React.useState(ALL)
  const initialDate = searchParams?.get('date') ?? null
  const [date, setDate] = React.useState<string | null>(initialDate && /^\d{4}-\d{2}-\d{2}$/.test(initialDate) ? initialDate : null)
  const [buildingId, setBuildingId] = React.useState(ALL)
  const { buildings, failed: buildingsFailed, retry: retryBuildings } = useBookingBuildingOptions(scopeVersion)
  const [reloadToken, setReloadToken] = React.useState(0)
  const reload = React.useCallback(() => setReloadToken((value) => value + 1), [])

  const [filterScope, setFilterScope] = React.useState(scopeVersion)
  if (filterScope !== scopeVersion) {
    setFilterScope(scopeVersion)
    setBuildingId(ALL)
    setPage(1)
  }

  const clearUrlFilter = React.useCallback((name: 'id' | 'unitId') => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    params.delete(name)
    if (name === 'unitId') params.delete('unitName')
    const query = params.toString()
    setPage(1)
    router.replace(query ? `${pathname ?? ''}?${query}` : pathname ?? '')
  }, [pathname, router, searchParams])

  const listParams = React.useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) })
    if (bookingId) params.set('id', bookingId)
    if (unitId) params.set('unitId', unitId)
    if (search.trim()) params.set('search', search.trim())
    if (BOOKING_STATE_FILTERS[chip]) params.set('status', BOOKING_STATE_FILTERS[chip])
    if (buildingId !== ALL) params.set('buildingId', buildingId)
    if (date) params.set('date', date)
    return params
  }, [page, search, chip, buildingId, date, bookingId, unitId])
  const { rows, total, totalPages, loading, loadError, crmAccess } = useBookingsList(listParams, `${reloadToken}:${scopeVersion}`)
  const unitLabel = unitId ? unitFilterLabel(t, rows.find((row) => row.unitId === unitId)?.unitName ?? urlUnitName) : null

  const cancelBooking = React.useCallback(async (booking: BookingSummary) => {
    const confirmed = await confirm({
      title: t('property_management.bookings.cancel.title', 'Cancel this booking?'),
      description: t('property_management.bookings.cancel.body', 'The slot is released and the booking\'s sales order is moved to the cancelled status. This cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const errorMessage = t('property_management.bookings.cancel.error', 'Could not cancel the booking.')
    try {
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(buildOptimisticLockHeader(booking.updatedAt), () =>
            apiCallOrThrow(`/api/property_management/bookings/${encodeURIComponent(booking.id)}/cancel`, { method: 'POST' }, { errorMessage }),
          ),
        mutationPayload: { id: booking.id },
        context: { formId: 'property-management-bookings', resourceKind: BOOKING_RESOURCE_KIND, resourceId: booking.id, retryLastMutation },
      })
      flash(t('property_management.bookings.cancel.done', 'Booking cancelled.'), 'success')
      reload()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: reload })) return
      flash(readErrorMessage(err, errorMessage), 'error')
      const code = readErrorCode(err)
      if (code && STALE_CANCEL_CODES.has(code)) reload()
    }
  }, [confirm, reload, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<BookingSummary>[]>(() => [
    {
      accessorKey: 'unitName',
      header: t('property_management.bookings.list.column.unit', 'Unit'),
      meta: { alwaysVisible: true },
      cell: ({ row }) => (
        <span className="flex flex-col">
          {canEditUnits ? (
            <Link href={`/backend/property_management/units/${row.original.unitId}`} className="font-medium hover:underline">{row.original.unitName ?? '—'}</Link>
          ) : (
            <span className="font-medium">{row.original.unitName ?? '—'}</span>
          )}
          {row.original.floorName ? <span className="text-xs text-muted-foreground">{row.original.floorName}</span> : null}
        </span>
      ),
    },
    { accessorKey: 'buildingName', header: t('property_management.bookings.list.column.location', 'Location'), meta: { truncate: true, maxWidth: '180px' } },
    {
      accessorKey: 'bookedByName',
      header: t('property_management.bookings.list.column.bookedBy', 'Booked by'),
      cell: ({ row }) => {
        if (!crmAccess.people) return <CrmHiddenNote testId="pm-bookings-crm-hidden" />
        const name = row.original.bookedByName
        return name ? <GatedLink target="person" href={`/backend/customers/people/${row.original.bookedByPersonId}`}>{name}</GatedLink> : '—'
      },
    },
    {
      accessorKey: 'startsAt',
      header: t('property_management.bookings.list.column.time', 'Date & time'),
      meta: { truncate: false },
      cell: ({ row }) => {
        const time = formatBookingTime(t, row.original, locale)
        return (
          <span className="flex flex-col whitespace-nowrap">
            <span>{time.date}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{time.time}</span>
          </span>
        )
      },
    },
    {
      accessorKey: 'productName',
      header: t('property_management.bookings.list.column.bookedAs', 'Booked as'),
      meta: { truncate: false },
      cell: ({ row }) => {
        const bookedAs = formatBookedAs(t, row.original, locale)
        return (
          <span className="flex flex-col">
            <span>{bookedAs.product} · <strong>{bookedAs.price}</strong></span>
            <span className="text-xs text-muted-foreground">{bookedAs.rate}</span>
          </span>
        )
      },
    },
    {
      accessorKey: 'salesOrderNumber',
      header: t('property_management.bookings.list.column.order', 'Order'),
      meta: { truncate: false },
      cell: ({ row }) => row.original.salesOrderId ? (
        <span className="flex flex-col">
          {row.original.salesOrderNumber ? (
            <GatedLink target="salesOrder" href={`/backend/sales/orders/${encodeURIComponent(row.original.salesOrderId)}`} className="font-mono">{row.original.salesOrderNumber}</GatedLink>
          ) : <span>—</span>}
          {row.original.salesOrderCancelled ? (
            <span className="text-xs text-muted-foreground">{t('property_management.bookings.list.orderCancelled', 'Order cancelled')}</span>
          ) : null}
        </span>
      ) : '—',
    },
    {
      accessorKey: 'status',
      header: t('property_management.bookings.list.column.status', 'Status'),
      cell: ({ row }) => {
        const badge = bookingStatusBadge(row.original.status)
        return <StatusBadge variant={badge.variant} appearance={badge.appearance} dot>{bookingStatusLabel(t, row.original.status)}</StatusBadge>
      },
    },
  ], [canEditUnits, crmAccess.people, locale, t])

  return (
    <Page>
      <PageBody className="space-y-4">
        <DataTable<BookingSummary>
          title={t('property_management.bookings.list.title', 'Bookings')}
          titleHeadingLevel={1}
          toolbar={(
            <BookingsToolbar
              search={search}
              onSearchChange={(value) => { setSearch(value); setPage(1) }}
              chip={chip}
              onChipChange={(value) => { setChip(value); setPage(1) }}
              buildingId={buildingId}
              onBuildingChange={(value) => { setBuildingId(value); setPage(1) }}
              buildings={buildings}
              buildingsFailed={buildingsFailed}
              onRetryBuildings={retryBuildings}
              date={date}
              onDateChange={(value) => { setDate(value); setPage(1) }}
              bookingId={bookingId}
              onClearBookingId={() => clearUrlFilter('id')}
              unitFilterLabel={unitLabel}
              onClearUnit={() => clearUrlFilter('unitId')}
            />
          )}
          refreshButton={{ label: t('property_management.common.refresh', 'Refresh'), onRefresh: reload, isRefreshing: loading }}
          columns={columns}
          data={rows}
          isLoading={loading}
          rowActions={canManage ? (row) => canCancelBooking(row) ? (
            <RowActions
              items={[{
                id: 'cancel',
                label: t('property_management.bookings.list.cancelAction', 'Cancel booking'),
                destructive: true,
                onSelect: () => { void cancelBooking(row) },
              }]}
            />
          ) : null : undefined}
          emptyState={loadError ? (
            <ErrorMessage
              label={loadError}
              action={<Button type="button" variant="outline" onClick={reload}>{t('property_management.common.retry', 'Try again')}</Button>}
            />
          ) : (
            <ListEmptyState
              title={t('property_management.bookings.list.empty.title', 'No bookings')}
              description={t('property_management.bookings.list.empty.description', 'Bookings made in the customer portal or through the API appear here.')}
            />
          )}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}

export default BookingsListPage
