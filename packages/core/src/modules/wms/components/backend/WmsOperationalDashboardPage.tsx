"use client"

import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  ArrowDown,
  ClipboardList,
  ExternalLink,
  MapPin,
  Package,
  RefreshCw,
  SlidersHorizontal,
  Warehouse as WarehouseIcon2,
} from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { BarChart } from '@open-mercato/ui/backend/charts'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { LinkButton } from '@open-mercato/ui/primitives/link-button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type {
  OperationalDashboardActivityRow,
  OperationalDashboardExpiryLotRow,
  OperationalDashboardKpi,
  OperationalDashboardPayload,
} from '../../lib/loadOperationalDashboard'
import {
  inventoryMovementReasonLabel,
  type InventoryDisplayTranslator,
} from '../../lib/inventoryDisplayUi'
import { AdjustInventoryDialog } from './AdjustInventoryDialog'
import { ChangeLotStatusDialog } from './ChangeLotStatusDialog'
import { CycleCountWizardDialog } from './CycleCountWizardDialog'
import { MoveInventoryDialog } from './MoveInventoryDialog'
import { ReceiveInventoryDialog } from './ReceiveInventoryDialog'
import { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

type WarehouseOption = {
  id: string
  name?: string | null
  code?: string | null
}

type PagedWarehouses = {
  items: WarehouseOption[]
}

const AUTO_REFRESH_MS = 60_000

function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const width = 160
  const height = 36
  const max = Math.max(...values, 1)
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? width / 2 : (index / (values.length - 1)) * width
    const y = height - (value / max) * (height - 4) - 2
    return `${x},${y}`
  })

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(' ')}
        className="text-status-info-icon"
      />
    </svg>
  )
}

function formatActivityTitle(
  row: OperationalDashboardActivityRow,
  t: ReturnType<typeof useT>,
): string {
  const sku = row.variantSku?.trim() || row.variantId
  const quantity = Math.abs(row.quantity)
  const signedQuantity = row.quantity
  switch (row.movementType) {
    case 'receipt':
    case 'return_receive':
      return t('wms.backend.dashboard.activity.titles.received', 'Received {quantity}× {sku}', {
        quantity,
        sku,
      })
    case 'adjust':
      return t('wms.backend.dashboard.activity.titles.adjusted', 'Adjusted {quantity}× {sku}', {
        quantity: `${signedQuantity >= 0 ? '+' : ''}${signedQuantity}`,
        sku,
      })
    case 'transfer':
      return t('wms.backend.dashboard.activity.titles.moved', 'Moved {quantity}× {sku}', {
        quantity,
        sku,
      })
    case 'pick':
    case 'pack':
      return t('wms.backend.dashboard.activity.titles.allocated', 'Allocated {quantity}× {sku}', {
        quantity,
        sku,
      })
    case 'cycle_count':
      return t('wms.backend.dashboard.activity.titles.reconciled', 'Inventory reconciled — {sku}', {
        sku,
      })
    default:
      return t('wms.backend.dashboard.activity.titles.generic', '{type} {quantity}× {sku}', {
        type: row.movementType,
        quantity,
        sku,
      })
  }
}

function formatActivitySubtitle(
  row: OperationalDashboardActivityRow,
  t: InventoryDisplayTranslator,
): string | null {
  const reasonLabel = inventoryMovementReasonLabel(
    {
      reasonCode: row.reasonCode,
      reason: row.reason,
      movementType: row.movementType,
    },
    t,
  )
  if (reasonLabel) return reasonLabel
  if (row.referenceType && row.referenceId) return `${row.referenceType} · ${row.referenceId}`
  return null
}

function createDateTimeFormatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, options)
}

export function resolveDashboardFirstRunMode(input: {
  warehousesLoading: boolean
  warehousesError: boolean
  hasWarehouses: boolean
  locationsLoading: boolean
  locationsError: boolean
  locationsCount: number
}): 'no-warehouses' | 'no-locations' | null {
  if (input.warehousesLoading || input.warehousesError) return null
  if (!input.hasWarehouses) return 'no-warehouses'
  if (input.locationsLoading || input.locationsError) return null
  if (input.locationsCount === 0) return 'no-locations'
  return null
}

type DashboardKpiCardProps = {
  kpi: OperationalDashboardKpi
  title: string
  caption: string
  badgeLabel: string | null
  badgeVariant: StatusBadgeVariant
  ctaLabel: string
  href: string
}

function DashboardKpiCard({
  kpi,
  title,
  caption,
  badgeLabel,
  badgeVariant,
  ctaLabel,
  href,
}: DashboardKpiCardProps) {
  return (
    <section className="flex min-h-52 flex-col rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-3 text-xs text-muted-foreground">{caption}</p>
      <div className="mt-2 flex items-end gap-3">
        <p className="text-3xl font-semibold tracking-tight">{kpi.count}</p>
        {badgeLabel ? (
          <StatusBadge variant={badgeVariant} dot>
            {badgeLabel}
          </StatusBadge>
        ) : null}
      </div>
      <Sparkline values={kpi.sparkline} className="mt-3 h-9 w-full max-w-40" />
      <LinkButton asChild variant="primary" size="sm" className="mt-4 w-fit">
        <Link href={href}>{ctaLabel}</Link>
      </LinkButton>
    </section>
  )
}

type ExpiryLotListProps = {
  title: string
  emptyLabel: string
  viewAllLabel: string
  viewAllHref: string
  rows: OperationalDashboardExpiryLotRow[]
  expiryFormatter: Intl.DateTimeFormat
  quantityFormatter: Intl.NumberFormat
  canAdjust: boolean
  onChangeStatus: (row: OperationalDashboardExpiryLotRow) => void
  onMove: (row: OperationalDashboardExpiryLotRow) => void
  t: ReturnType<typeof useT>
}

function ExpiryLotList({
  title,
  emptyLabel,
  viewAllLabel,
  viewAllHref,
  rows,
  expiryFormatter,
  quantityFormatter,
  canAdjust,
  onChangeStatus,
  onMove,
  t,
}: ExpiryLotListProps) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <LinkButton asChild variant="gray" size="sm" className="h-8 px-2">
          <Link href={viewAllHref}>{viewAllLabel}</Link>
        </LinkButton>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => {
            const badgeVariant: StatusBadgeVariant = row.category === 'pastDue' ? 'error' : 'warning'
            return (
              <li key={row.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{row.lotNumber}</p>
                  <p className="truncate text-xs text-muted-foreground">{row.sku}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StatusBadge variant={badgeVariant} dot>
                      {expiryFormatter.format(new Date(row.expiresAt))}
                    </StatusBadge>
                    <span className="text-xs text-muted-foreground">
                      {t(
                        'wms.backend.dashboard.expiry.available',
                        '{quantity} available',
                        { quantity: quantityFormatter.format(row.availableQuantity) },
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {canAdjust ? (
                    <RowActions
                      items={[
                        {
                          id: 'change-status',
                          label: t('wms.backend.lots.actions.changeStatus', 'Change status'),
                          onSelect: () => onChangeStatus(row),
                        },
                        {
                          id: 'move',
                          label: t('wms.backend.lots.actions.move', 'Move'),
                          onSelect: () => onMove(row),
                        },
                      ]}
                    />
                  ) : null}
                  <Button asChild type="button" variant="ghost" size="icon" className="size-7 shrink-0">
                    <Link
                      href={`/backend/wms/lot/${row.id}`}
                      aria-label={t('wms.backend.dashboard.expiry.openLot', 'Open lot')}
                    >
                      <ExternalLink className="size-3.5" />
                    </Link>
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

const movementStatusMap: Record<string, StatusBadgeVariant> = {
  receipt: 'success',
  return_receive: 'success',
  adjust: 'warning',
  transfer: 'info',
  pick: 'info',
  pack: 'info',
  cycle_count: 'neutral',
  putaway: 'info',
  ship: 'success',
}

export default function WmsOperationalDashboardPage() {
  const t = useT()
  const locale = useLocale()
  const access = useWmsInventoryMutationAccess()
  const [warehouseId, setWarehouseId] = React.useState<string>('all')
  const [adjustOpen, setAdjustOpen] = React.useState(false)
  const [cycleOpen, setCycleOpen] = React.useState(false)
  const [changeStatusOpen, setChangeStatusOpen] = React.useState(false)
  const [moveOpen, setMoveOpen] = React.useState(false)
  const [receiveOpen, setReceiveOpen] = React.useState(false)
  const [activeExpiryLot, setActiveExpiryLot] = React.useState<OperationalDashboardExpiryLotRow | null>(null)

  const openExpiryChangeStatus = React.useCallback((row: OperationalDashboardExpiryLotRow) => {
    setActiveExpiryLot(row)
    setChangeStatusOpen(true)
  }, [])

  const openExpiryMove = React.useCallback((row: OperationalDashboardExpiryLotRow) => {
    setActiveExpiryLot(row)
    setMoveOpen(true)
  }, [])

  const activityTimeFormatter = React.useMemo(
    () =>
      createDateTimeFormatter(locale, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  )

  const lastUpdatedFormatter = React.useMemo(
    () =>
      createDateTimeFormatter(locale, {
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  )

  const expiryDateFormatter = React.useMemo(
    () =>
      createDateTimeFormatter(locale, {
        month: '2-digit',
        day: '2-digit',
        year: '2-digit',
      }),
    [locale],
  )

  const quantityFormatter = React.useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  )

  const warehousesQuery = useQuery({
    queryKey: ['wms-dashboard', 'warehouses'],
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '100', sortField: 'name', sortDir: 'asc' })
      const call = await apiCall<PagedWarehouses>(`/api/wms/warehouses?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.dashboard.errors.warehouses', 'Failed to load warehouses.'))
      }
      return call.result?.items ?? []
    },
  })

  const hasWarehouses = (warehousesQuery.data ?? []).length > 0

  const locationsCountQuery = useQuery({
    queryKey: ['wms-dashboard', 'locations-count'],
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '1' })
      const call = await apiCall<{ total?: number }>(`/api/wms/locations?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.dashboard.errors.locations', 'Failed to load locations.'))
      }
      return call.result?.total ?? 0
    },
    enabled: hasWarehouses,
  })

  const dashboardQuery = useQuery({
    queryKey: ['wms-dashboard', 'operational', warehouseId],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (warehouseId !== 'all') params.set('warehouseId', warehouseId)
      const call = await apiCall<OperationalDashboardPayload>(
        `/api/wms/dashboard/operational?${params.toString()}`,
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.dashboard.errors.load', 'Failed to load dashboard.'))
      }
      return call.result as OperationalDashboardPayload
    },
    refetchInterval: AUTO_REFRESH_MS,
  })

  const selectedWarehouse = warehousesQuery.data?.find((warehouse) => warehouse.id === warehouseId)
  const warehouseLabel =
    warehouseId === 'all'
      ? t('wms.backend.dashboard.filters.allWarehouses', 'All warehouses')
      : selectedWarehouse?.name || selectedWarehouse?.code || warehouseId

  const firstRunMode = React.useMemo<'no-warehouses' | 'no-locations' | null>(
    () =>
      resolveDashboardFirstRunMode({
        warehousesLoading: warehousesQuery.isLoading,
        warehousesError: warehousesQuery.isError,
        hasWarehouses,
        locationsLoading: locationsCountQuery.isLoading,
        locationsError: locationsCountQuery.isError,
        locationsCount: locationsCountQuery.data ?? 0,
      }),
    [
      warehousesQuery.isLoading,
      warehousesQuery.isError,
      hasWarehouses,
      locationsCountQuery.isLoading,
      locationsCountQuery.isError,
      locationsCountQuery.data,
    ],
  )

  const kpiConfig = React.useMemo(() => {
    const buildLotsHref = (expiryWindow: 'expiringSoon' | 'pastDue') => {
      const params = new URLSearchParams({ expiryWindow })
      if (warehouseId !== 'all') params.set('warehouseId', warehouseId)
      return `/backend/wms/lots?${params.toString()}`
    }
    const buildInventoryHref = (lowStock?: 'belowReorder' | 'belowSafety') => {
      const params = new URLSearchParams()
      if (warehouseId !== 'all') params.set('warehouseId', warehouseId)
      if (lowStock) params.set('lowStock', lowStock)
      const query = params.toString()
      return query ? `/backend/wms/inventory?${query}` : '/backend/wms/inventory'
    }
    const inventoryHref = buildInventoryHref()
    const reservationsHref = warehouseId === 'all'
      ? '/backend/wms/reservations'
      : `/backend/wms/reservations?warehouseId=${encodeURIComponent(warehouseId)}`
    const movementsHref = warehouseId === 'all'
      ? '/backend/wms/movements'
      : `/backend/wms/movements?warehouseId=${encodeURIComponent(warehouseId)}`

    return {
      lowStock: {
        title: t('wms.backend.dashboard.kpis.lowStock.title', 'Low stock'),
        caption: t('wms.backend.dashboard.kpis.lowStock.caption', 'Below reorder point'),
        ctaLabel: t('wms.backend.dashboard.kpis.lowStock.cta', 'View low stock'),
        href: buildInventoryHref('belowReorder'),
        resolveBadge: (kpi: OperationalDashboardKpi) => ({
          variant: 'warning' as const,
          label: t('wms.backend.dashboard.kpis.lowStock.badgeActive', '{count} active', { count: kpi.count }),
        }),
      },
      reorderCritical: {
        title: t('wms.backend.dashboard.kpis.reorderCritical.title', 'Reorder critical'),
        caption: t('wms.backend.dashboard.kpis.reorderCritical.caption', 'Below safety stock'),
        ctaLabel: t('wms.backend.dashboard.kpis.reorderCritical.cta', 'View critical'),
        href: buildInventoryHref('belowSafety'),
        resolveBadge: (kpi: OperationalDashboardKpi) => ({
          variant: 'error' as const,
          label: t('wms.backend.dashboard.kpis.reorderCritical.badge', '{count} critical', { count: kpi.count }),
        }),
      },
      expiringSoon: {
        title: t('wms.backend.dashboard.kpis.expiringSoon.title', 'Expiring soon'),
        caption: t('wms.backend.dashboard.kpis.expiringSoon.caption', 'Lots expiring in 30 days'),
        ctaLabel: t('wms.backend.dashboard.kpis.expiringSoon.cta', 'View expiry'),
        href: buildLotsHref('expiringSoon'),
        resolveBadge: (kpi: OperationalDashboardKpi) => ({
          variant: 'warning' as const,
          label: t('wms.backend.dashboard.kpis.expiringSoon.badge', '{count} lots', { count: kpi.count }),
        }),
      },
      pastDue: {
        title: t('wms.backend.dashboard.kpis.pastDue.title', 'Past due'),
        caption: t('wms.backend.dashboard.kpis.pastDue.caption', 'Expired lots with on-hand stock'),
        ctaLabel: t('wms.backend.dashboard.kpis.pastDue.cta', 'View past due'),
        href: buildLotsHref('pastDue'),
        resolveBadge: (kpi: OperationalDashboardKpi) => ({
          variant: 'error' as const,
          label: t('wms.backend.dashboard.kpis.pastDue.badge', '{count} lots', { count: kpi.count }),
        }),
      },
      agingReservations: {
        title: t('wms.backend.dashboard.kpis.agingReservations.title', 'Aging reservations'),
        caption: t('wms.backend.dashboard.kpis.agingReservations.caption', 'Active holds older than 7 days'),
        ctaLabel: t('wms.backend.dashboard.kpis.agingReservations.cta', 'View reservations'),
        href: reservationsHref,
        resolveBadge: (kpi: OperationalDashboardKpi) => ({
          variant: 'warning' as const,
          label: t('wms.backend.dashboard.kpis.agingReservations.badge', '{count} aging', { count: kpi.count }),
        }),
      },
      todaysMoves: {
        title: t('wms.backend.dashboard.kpis.todaysMoves.title', "Today's moves"),
        caption: t('wms.backend.dashboard.kpis.todaysMoves.caption', 'Movements posted today'),
        ctaLabel: t('wms.backend.dashboard.kpis.todaysMoves.cta', 'View ledger'),
        href: movementsHref,
        resolveBadge: (kpi: OperationalDashboardKpi) => {
          if (kpi.deltaSinceYesterday === null) {
            return { variant: 'neutral' as const, label: null }
          }
          return {
            variant: kpi.deltaSinceYesterday >= 0 ? ('success' as const) : ('neutral' as const),
            label:
              kpi.deltaSinceYesterday >= 0
                ? t('wms.backend.dashboard.kpis.todaysMoves.badgeUp', '+{count} vs yesterday', {
                    count: kpi.deltaSinceYesterday,
                  })
                : t('wms.backend.dashboard.kpis.todaysMoves.badgeDown', '{count} vs yesterday', {
                    count: kpi.deltaSinceYesterday,
                  }),
          }
        },
      },
    }
  }, [t, warehouseId])

  const monthlyTrendData = React.useMemo(
    () =>
      (dashboardQuery.data?.monthlyTrends ?? []).map((point) => ({
        month: point.month,
        receive: point.receive,
        allocate: point.allocate,
      })),
    [dashboardQuery.data?.monthlyTrends],
  )

  const expiryLotsByCategory = React.useMemo(() => {
    const lots = dashboardQuery.data?.expiryLots ?? []
    return {
      expiringSoon: lots.filter((lot) => lot.category === 'expiringSoon'),
      pastDue: lots.filter((lot) => lot.category === 'pastDue'),
    }
  }, [dashboardQuery.data?.expiryLots])

  const movementsHref = kpiConfig.todaysMoves.href

  const activityColumns = React.useMemo<ColumnDef<OperationalDashboardActivityRow>[]>(
    () => [
      {
        id: 'event',
        header: t('wms.backend.dashboard.activity.columns.event', 'Event'),
        accessorKey: 'movementType',
        cell: ({ row }) => {
          const movementLabel = t(
            `wms.backend.dashboard.activity.types.${row.original.movementType}`,
            row.original.movementType,
          )
          const badgeVariant = movementStatusMap[row.original.movementType] ?? 'neutral'
          return (
            <StatusBadge variant={badgeVariant} dot>
              {movementLabel}
            </StatusBadge>
          )
        },
        meta: { maxWidth: '7rem' },
      },
      {
        id: 'details',
        header: t('wms.backend.dashboard.activity.columns.details', 'Details'),
        cell: ({ row }) => {
          const subtitle = formatActivitySubtitle(row.original, t)
          return (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{formatActivityTitle(row.original, t)}</p>
              {subtitle ? (
                <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
          )
        },
      },
      {
        id: 'location',
        header: t('wms.backend.dashboard.activity.columns.location', 'Location'),
        accessorKey: 'locationLabel',
        cell: ({ row }) => (
          <p className="truncate text-sm text-muted-foreground">{row.original.locationLabel}</p>
        ),
        meta: { maxWidth: '11rem', truncate: true },
      },
      {
        id: 'time',
        header: t('wms.backend.dashboard.activity.columns.time', 'Time'),
        accessorKey: 'performedAt',
        cell: ({ row }) => (
          <p className="text-xs leading-4 text-muted-foreground">
            {activityTimeFormatter.format(new Date(row.original.performedAt))}
          </p>
        ),
        meta: { maxWidth: '5rem' },
      },
      {
        id: 'actions',
        header: t('wms.backend.dashboard.activity.columns.actions', 'Actions'),
        cell: ({ row }) => (
          <Button asChild type="button" variant="ghost" size="icon" className="size-7">
            <Link
              href={`${movementsHref}#${row.original.id}`}
              aria-label={t('wms.backend.dashboard.activity.open', 'Open movement')}
            >
              <ExternalLink className="size-3.5" />
            </Link>
          </Button>
        ),
        meta: { maxWidth: '2.5rem' },
      },
    ],
    [activityTimeFormatter, movementsHref, t],
  )

  const subtitle = dashboardQuery.data?.lastUpdatedAt
    ? t('wms.backend.dashboard.subtitle', 'Live activity for today · auto-refresh 60s · last update {time}', {
        time: lastUpdatedFormatter.format(new Date(dashboardQuery.data.lastUpdatedAt)),
      })
    : t('wms.backend.dashboard.subtitleLoading', 'Live activity for today · auto-refresh 60s')

  return (
    <Page>
      <PageBody className="space-y-6">
        <PageHeader
          title={t('wms.backend.dashboard.title', 'Operational dashboard')}
          description={subtitle}
          actions={(
            <>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="w-full max-w-xs sm:w-56">
                  <SelectValue placeholder={warehouseLabel} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t('wms.backend.dashboard.filters.allWarehouses', 'All warehouses')}
                  </SelectItem>
                  {(warehousesQuery.data ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name || warehouse.code || warehouse.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                onClick={() => { void dashboardQuery.refetch() }}
                disabled={dashboardQuery.isFetching}
              >
                <RefreshCw className={`size-4 ${dashboardQuery.isFetching ? 'animate-spin' : ''}`} />
                {t('wms.backend.dashboard.actions.refresh', 'Refresh')}
              </Button>
            </>
          )}
        />

        {dashboardQuery.isLoading ? (
          <LoadingMessage label={t('wms.backend.dashboard.loading', 'Loading dashboard…')} />
        ) : null}

        {dashboardQuery.isError ? (
          <ErrorMessage
            label={t('wms.backend.dashboard.errors.load', 'Failed to load dashboard.')}
            action={(
              <Button type="button" variant="outline" size="sm" onClick={() => { void dashboardQuery.refetch() }}>
                {t('wms.backend.dashboard.actions.refresh', 'Refresh')}
              </Button>
            )}
          />
        ) : null}

        {firstRunMode === 'no-warehouses' ? (
          <section className="rounded-lg border-2 border-dashed border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto max-w-sm">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
                <WarehouseIcon2 className="size-7 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold">
                {t('wms.backend.dashboard.firstRun.title', 'Set up your warehouse')}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(
                  'wms.backend.dashboard.firstRun.description',
                  'Create a warehouse, add storage locations, then receive your first stock to start tracking inventory.',
                )}
              </p>
              <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <LinkButton asChild variant="primary" size="sm">
                  <Link href="/backend/config/wms">
                    <WarehouseIcon2 className="size-4" />
                    {t('wms.backend.dashboard.firstRun.actions.createWarehouse', 'Create warehouse')}
                  </Link>
                </LinkButton>
                <LinkButton asChild variant="gray" size="sm">
                  <Link href="/backend/config/wms">
                    <MapPin className="size-4" />
                    {t('wms.backend.dashboard.firstRun.actions.addLocations', 'Add locations')}
                  </Link>
                </LinkButton>
                {access.canReceive ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => setReceiveOpen(true)}>
                    <ArrowDown className="size-4" />
                    {t('wms.backend.dashboard.firstRun.actions.receiveStock', 'Receive first stock')}
                  </Button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {firstRunMode === 'no-locations' ? (
          <section className="rounded-lg border-2 border-dashed border-border bg-card p-8 text-center shadow-sm">
            <div className="mx-auto max-w-sm">
              <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-muted">
                <MapPin className="size-7 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold">
                {t('wms.backend.dashboard.firstRun.noLocations.title', 'Add storage locations')}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {t(
                  'wms.backend.dashboard.firstRun.noLocations.description',
                  'Your warehouse is set up — add at least one storage location before you can receive stock.',
                )}
              </p>
              <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
                <LinkButton asChild variant="primary" size="sm">
                  <Link href="/backend/config/wms">
                    <MapPin className="size-4" />
                    {t('wms.backend.dashboard.firstRun.actions.addLocations', 'Add locations')}
                  </Link>
                </LinkButton>
              </div>
            </div>
          </section>
        ) : null}

        {dashboardQuery.data ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {dashboardQuery.data.kpis.map((kpi) => {
                const config = kpiConfig[kpi.id]
                const badge = config.resolveBadge(kpi)
                return (
                  <DashboardKpiCard
                    key={kpi.id}
                    kpi={kpi}
                    title={config.title}
                    caption={config.caption}
                    badgeLabel={badge.label}
                    badgeVariant={badge.variant}
                    ctaLabel={config.ctaLabel}
                    href={config.href}
                  />
                )
              })}
            </section>

            <section className="rounded-lg border bg-card shadow-sm">
              <div className="border-b px-5 py-4">
                <h2 className="text-base font-semibold">
                  {t('wms.backend.dashboard.expiry.title', 'Expiry watch')}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t(
                    'wms.backend.dashboard.expiry.description',
                    'Upcoming and overdue lots with on-hand stock in the selected warehouse scope.',
                  )}
                </p>
              </div>
              <div className="grid gap-6 p-5 md:grid-cols-2">
                <ExpiryLotList
                  title={t('wms.backend.dashboard.expiry.expiringSoon.title', 'Expiring soon')}
                  emptyLabel={t(
                    'wms.backend.dashboard.expiry.expiringSoon.empty',
                    'No lots expiring within the next 30 days.',
                  )}
                  viewAllLabel={t(
                    'wms.backend.dashboard.expiry.expiringSoon.viewAll',
                    'View all expiring →',
                  )}
                  viewAllHref={kpiConfig.expiringSoon.href}
                  rows={expiryLotsByCategory.expiringSoon}
                  expiryFormatter={expiryDateFormatter}
                  quantityFormatter={quantityFormatter}
                  canAdjust={access.canAdjust}
                  onChangeStatus={openExpiryChangeStatus}
                  onMove={openExpiryMove}
                  t={t}
                />
                <ExpiryLotList
                  title={t('wms.backend.dashboard.expiry.pastDue.title', 'Past due')}
                  emptyLabel={t(
                    'wms.backend.dashboard.expiry.pastDue.empty',
                    'No expired lots with available stock.',
                  )}
                  viewAllLabel={t(
                    'wms.backend.dashboard.expiry.pastDue.viewAll',
                    'View all past due →',
                  )}
                  viewAllHref={kpiConfig.pastDue.href}
                  rows={expiryLotsByCategory.pastDue}
                  expiryFormatter={expiryDateFormatter}
                  quantityFormatter={quantityFormatter}
                  canAdjust={access.canAdjust}
                  onChangeStatus={openExpiryChangeStatus}
                  onMove={openExpiryMove}
                  t={t}
                />
              </div>
            </section>

            <section className="rounded-lg border bg-card shadow-sm">
              <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
                <h2 className="text-base font-semibold">
                  {t('wms.backend.dashboard.trends.title', 'Monthly trends')}
                </h2>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2.5 rounded-sm bg-chart-1" aria-hidden="true" />
                    {t('wms.backend.dashboard.trends.receive', 'Receive')}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="size-2.5 rounded-sm bg-chart-2" aria-hidden="true" />
                    {t('wms.backend.dashboard.trends.allocate', 'Allocate')}
                  </span>
                </div>
              </div>
              <div className="p-5">
                <BarChart
                  data={monthlyTrendData}
                  index="month"
                  categories={['receive', 'allocate']}
                  showLegend={false}
                  categoryLabels={{
                    receive: t('wms.backend.dashboard.trends.receive', 'Receive'),
                    allocate: t('wms.backend.dashboard.trends.allocate', 'Allocate'),
                  }}
                  emptyMessage={t('wms.backend.dashboard.trends.empty', 'No movement trends yet.')}
                  className="border-0 bg-transparent p-0 shadow-none"
                />
              </div>
            </section>

            <DataTable<OperationalDashboardActivityRow>
              title={t('wms.backend.dashboard.activity.title', 'Recent activity')}
              columns={activityColumns}
              data={dashboardQuery.data.recentActivity}
              disableRowClick
              emptyState={t('wms.backend.dashboard.activity.empty', 'No recent movements yet.')}
              actions={(
                <Button asChild type="button" variant="ghost" size="sm">
                  <Link href={movementsHref}>
                    {t('wms.backend.dashboard.activity.viewAll', 'View all movements →')}
                  </Link>
                </Button>
              )}
            />

            <section className="flex flex-col gap-4 rounded-lg border bg-card px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold">
                  {t('wms.backend.dashboard.quickActions.title', 'Quick actions')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'wms.backend.dashboard.quickActions.description',
                    'Open a drawer without leaving the dashboard',
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild type="button" variant="outline">
                  <Link href={kpiConfig.lowStock.href}>
                    <Package className="size-4" />
                    {t('wms.backend.dashboard.quickActions.inventory', 'Open inventory console')}
                  </Link>
                </Button>
                {access.canAdjust ? (
                  <Button type="button" variant="outline" onClick={() => setAdjustOpen(true)}>
                    <SlidersHorizontal className="size-4" />
                    {t('wms.backend.dashboard.quickActions.adjust', 'Adjust inventory')}
                  </Button>
                ) : null}
                {access.canCycleCount ? (
                  <Button type="button" variant="outline" onClick={() => setCycleOpen(true)}>
                    <ClipboardList className="size-4" />
                    {t('wms.backend.dashboard.quickActions.cycleCount', 'Cycle count')}
                  </Button>
                ) : null}
                <Button asChild type="button" variant="outline">
                  <Link href={movementsHref}>
                    {t('wms.backend.dashboard.quickActions.movements', 'View movements')}
                  </Link>
                </Button>
              </div>
            </section>
          </>
        ) : null}
      </PageBody>

      {access.canReceive ? (
        <ReceiveInventoryDialog open={receiveOpen} onOpenChange={setReceiveOpen} access={access} />
      ) : null}
      {access.canAdjust ? (
        <AdjustInventoryDialog open={adjustOpen} onOpenChange={setAdjustOpen} access={access} />
      ) : null}
      {access.canCycleCount ? (
        <CycleCountWizardDialog open={cycleOpen} onOpenChange={setCycleOpen} access={access} />
      ) : null}
      {access.canAdjust && activeExpiryLot ? (
        <>
          <ChangeLotStatusDialog
            open={changeStatusOpen}
            onOpenChange={setChangeStatusOpen}
            access={access}
            lotId={activeExpiryLot.id}
            currentStatus={activeExpiryLot.status}
            lotUpdatedAt={activeExpiryLot.updatedAt}
            onSuccess={() => {
              void dashboardQuery.refetch()
            }}
          />
          <MoveInventoryDialog
            open={moveOpen}
            onOpenChange={setMoveOpen}
            access={access}
            initialCatalogVariantId={activeExpiryLot.catalogVariantId}
            initialWarehouseId={warehouseId === 'all' ? undefined : warehouseId}
            initialLotId={activeExpiryLot.id}
            initialAvailable={activeExpiryLot.availableQuantity}
            lockSourceContext
          />
        </>
      ) : null}
    </Page>
  )
}
