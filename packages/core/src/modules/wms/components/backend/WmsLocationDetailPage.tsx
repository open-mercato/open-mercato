"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import {
  ArrowLeft,
  ArrowLeftRight,
  ClipboardList,
  Download,
  ExternalLink,
  MoreHorizontal,
  SlidersHorizontal,
  Warehouse,
} from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
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
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { cn } from '@open-mercato/shared/lib/utils'
import { E } from '#generated/entities.ids.generated'
import { AdjustInventoryDialog } from './AdjustInventoryDialog'
import { CycleCountWizardDialog } from './CycleCountWizardDialog'
import { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

const locationIdSchema = z.string().uuid()

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

type LocationRow = {
  id: string
  code?: string | null
  type?: string | null
  parent_id?: string | null
  warehouse_id?: string | null
  warehouse_name?: string | null
  warehouse_code?: string | null
  is_active?: boolean | null
  capacity_units?: string | number | null
  updated_at?: string | null
}

type InventoryProfileRow = {
  catalog_variant_id?: string | null
  reorder_point?: string | number | null
}

type InventoryBalanceRow = {
  id: string
  warehouse_id?: string | null
  warehouse_name?: string | null
  warehouse_code?: string | null
  location_id?: string | null
  location_code?: string | null
  catalog_variant_id?: string | null
  variant_name?: string | null
  variant_sku?: string | null
  lot_id?: string | null
  quantity_on_hand?: string | number | null
  quantity_reserved?: string | number | null
  quantity_allocated?: string | number | null
  quantity_available?: number | null
}

type InventoryLotRow = {
  id: string
  lot_number?: string | null
  expires_at?: string | null
  status?: string | null
}

type InventoryMovementRow = {
  id: string
  warehouse_id?: string | null
  warehouse_name?: string | null
  warehouse_code?: string | null
  location_from_id?: string | null
  location_from_code?: string | null
  location_to_id?: string | null
  location_to_code?: string | null
  catalog_variant_id?: string | null
  variant_sku?: string | null
  variant_name?: string | null
  quantity?: string | number | null
  type?: string | null
  reference_type?: string | null
  reference_id?: string | null
  reason?: string | null
  performed_at?: string | null
  received_at?: string | null
}

type InventoryMutationPreset = {
  warehouseId?: string
  locationId?: string
  catalogVariantId?: string
  lotId?: string
}

type ItemFilter = 'all' | 'sellable' | 'picking' | 'nearExpiry'

const NEAR_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000

function escapeCsvCell(value: string | number): string {
  const str = String(value ?? '')
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

function downloadCsvFile(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function toNumber(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatWarehouseLabel(row: {
  warehouse_name?: string | null
  warehouse_code?: string | null
  warehouse_id?: string | null
}): string {
  const code = (row.warehouse_code ?? '').trim()
  const name = (row.warehouse_name ?? '').trim()
  if (code && name) return `${code} · ${name}`
  return name || code || row.warehouse_id || '—'
}

function formatSkuLabel(row: InventoryBalanceRow): string {
  const sku = (row.variant_sku ?? '').trim()
  const name = (row.variant_name ?? '').trim()
  if (sku) return sku
  if (name) return name
  return row.catalog_variant_id || '—'
}

function formatVariantName(row: InventoryBalanceRow): string {
  return (row.variant_name ?? '').trim() || '—'
}

function formatLotLabel(
  lot: InventoryLotRow | undefined,
  locale: string,
): string {
  if (!lot) return '—'
  const number = (lot.lot_number ?? '').trim() || lot.id
  if (!lot.expires_at) return number
  const expires = new Date(lot.expires_at)
  if (Number.isNaN(expires.getTime())) return number
  const expLabel = new Intl.DateTimeFormat(locale, { month: '2-digit', year: '2-digit' }).format(expires)
  return `${number} · exp ${expLabel}`
}

function isNearExpiry(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return false
  const expires = new Date(expiresAt).getTime()
  if (Number.isNaN(expires)) return false
  return expires > nowMs && expires - nowMs <= NEAR_EXPIRY_MS
}

function isExpired(expiresAt: string | null | undefined, nowMs: number): boolean {
  if (!expiresAt) return false
  const expires = new Date(expiresAt).getTime()
  return !Number.isNaN(expires) && expires <= nowMs
}

function resolveItemStatus(
  row: InventoryBalanceRow,
  lot: InventoryLotRow | undefined,
  reorderPoint: number,
  nowMs: number,
): { variant: StatusBadgeVariant; labelKey: string; labelFallback: string } {
  if (lot?.status === 'expired' || isExpired(lot?.expires_at, nowMs)) {
    return {
      variant: 'error',
      labelKey: 'wms.backend.location.items.status.expired',
      labelFallback: 'Expired',
    }
  }
  if (isNearExpiry(lot?.expires_at, nowMs)) {
    return {
      variant: 'warning',
      labelKey: 'wms.backend.location.items.status.nearExpiry',
      labelFallback: 'Near expiry',
    }
  }
  const available = row.quantity_available ?? 0
  if (reorderPoint > 0 && available <= reorderPoint) {
    return {
      variant: 'warning',
      labelKey: 'wms.backend.location.items.status.lowStock',
      labelFallback: 'Low stock',
    }
  }
  const reserved = toNumber(row.quantity_reserved)
  const allocated = toNumber(row.quantity_allocated)
  if (reserved > 0 || allocated > 0) {
    return {
      variant: 'info',
      labelKey: 'wms.backend.location.items.status.reserved',
      labelFallback: 'Reserved',
    }
  }
  return {
    variant: 'success',
    labelKey: 'wms.backend.location.items.status.available',
    labelFallback: 'Available',
  }
}

function matchesItemFilter(
  row: InventoryBalanceRow,
  lot: InventoryLotRow | undefined,
  filter: ItemFilter,
  nowMs: number,
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'sellable':
      return (row.quantity_available ?? 0) > 0 && !isExpired(lot?.expires_at, nowMs) && lot?.status !== 'expired'
    case 'picking':
      return toNumber(row.quantity_reserved) > 0 || toNumber(row.quantity_allocated) > 0
    case 'nearExpiry':
      return isNearExpiry(lot?.expires_at, nowMs) || lot?.status === 'expired'
    default:
      return true
  }
}

function movementTypeLabel(type: string, t: ReturnType<typeof useT>): string {
  const key = `wms.backend.location.activity.types.${type}`
  const fallbacks: Record<string, string> = {
    receipt: 'Receive',
    return_receive: 'Receive',
    adjust: 'Adjust',
    transfer: 'Move',
    pick: 'Allocate',
    pack: 'Allocate',
    cycle_count: 'Reconcile',
    putaway: 'Putaway',
    ship: 'Ship',
  }
  return t(key, fallbacks[type] ?? type)
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

function formatMovementTitle(
  row: InventoryMovementRow,
  skuLabel: string,
  t: ReturnType<typeof useT>,
): string {
  const quantity = Math.abs(toNumber(row.quantity))
  const signedQuantity = toNumber(row.quantity)
  switch (row.type) {
    case 'receipt':
    case 'return_receive':
      return t('wms.backend.dashboard.activity.titles.received', 'Received {quantity}× {sku}', {
        quantity,
        sku: skuLabel,
      })
    case 'adjust':
      return t('wms.backend.dashboard.activity.titles.adjusted', 'Adjusted {quantity}× {sku}', {
        quantity: `${signedQuantity >= 0 ? '+' : ''}${signedQuantity}`,
        sku: skuLabel,
      })
    case 'transfer':
      return t('wms.backend.dashboard.activity.titles.moved', 'Moved {quantity}× {sku}', {
        quantity,
        sku: skuLabel,
      })
    case 'pick':
    case 'pack':
      return t('wms.backend.dashboard.activity.titles.allocated', 'Allocated {quantity}× {sku}', {
        quantity,
        sku: skuLabel,
      })
    case 'cycle_count':
      return t('wms.backend.dashboard.activity.titles.reconciled', 'Inventory reconciled — {sku}', {
        sku: skuLabel,
      })
    default:
      return t('wms.backend.dashboard.activity.titles.generic', '{type} {quantity}× {sku}', {
        type: row.type ?? 'movement',
        quantity,
        sku: skuLabel,
      })
  }
}

function formatMovementSubtitle(row: InventoryMovementRow): string | null {
  if (row.reason?.trim()) return row.reason.trim()
  if (row.reference_type && row.reference_id) return `${row.reference_type} · ${row.reference_id}`
  return null
}

function formatMovementLocation(
  row: InventoryMovementRow,
  locationId: string,
  locationCode: string,
): string {
  const fromId = row.location_from_id?.trim()
  const toId = row.location_to_id?.trim()
  const from = (row.location_from_code ?? '').trim() || fromId || '—'
  const to = (row.location_to_code ?? '').trim() || toId || '—'
  if (row.type === 'transfer' && from !== '—' && to !== '—') return `${from} → ${to}`
  if (fromId === locationId || toId === locationId) return locationCode || locationId
  return from !== '—' ? from : to
}

function formatRelativeDays(valueMs: number, t: ReturnType<typeof useT>): string {
  const days = Math.max(0, Math.floor((Date.now() - valueMs) / (24 * 60 * 60 * 1000)))
  if (days === 0) return t('wms.backend.location.kpis.lastCounted.today', 'Today')
  return t('wms.backend.location.kpis.lastCounted.daysAgo', '{days}d ago', { days })
}

type LocationKpiCardProps = {
  title: string
  caption: string
  value: string
  badgeLabel: string | null
  badgeVariant: StatusBadgeVariant
  ctaLabel: string
  ctaHref: string
}

function LocationKpiCard({
  title,
  caption,
  value,
  badgeLabel,
  badgeVariant,
  ctaLabel,
  ctaHref,
}: LocationKpiCardProps) {
  return (
    <section className="flex min-h-52 flex-col rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-3 text-xs text-muted-foreground">{caption}</p>
      <div className="mt-2 flex items-end gap-3">
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        {badgeLabel ? (
          <StatusBadge variant={badgeVariant} dot>
            {badgeLabel}
          </StatusBadge>
        ) : null}
      </div>
      <LinkButton asChild variant="primary" size="sm" className="mt-auto pt-4 w-fit">
        <Link href={ctaHref}>{ctaLabel}</Link>
      </LinkButton>
    </section>
  )
}

type WmsLocationDetailPageProps = {
  locationId: string
}

export default function WmsLocationDetailPage({ locationId }: WmsLocationDetailPageProps) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const access = useWmsInventoryMutationAccess()
  const parsedLocationId = locationIdSchema.safeParse(locationId.trim())
  const scopedLocationId = parsedLocationId.success ? parsedLocationId.data : null

  const [itemFilter, setItemFilter] = React.useState<ItemFilter>('all')
  const [itemsPage, setItemsPage] = React.useState(1)
  const [selectedBalanceIds, setSelectedBalanceIds] = React.useState<Set<string>>(() => new Set())
  const [adjustOpen, setAdjustOpen] = React.useState(false)
  const [adjustPreset, setAdjustPreset] = React.useState<InventoryMutationPreset>({})
  const [cycleOpen, setCycleOpen] = React.useState(false)
  const [cyclePreset, setCyclePreset] = React.useState<Pick<InventoryMutationPreset, 'warehouseId' | 'locationId'>>({})

  const itemsPageSize = 20

  const activityTimeFormatter = React.useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [locale],
  )

  const locationQuery = useQuery({
    queryKey: ['wms-location-detail', 'location', scopedLocationId],
    enabled: Boolean(scopedLocationId),
    queryFn: async () => {
      const params = new URLSearchParams({
        ids: scopedLocationId!,
        page: '1',
        pageSize: '1',
      })
      const call = await apiCall<PagedResponse<LocationRow>>(`/api/wms/locations?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.location.errors.location', 'Failed to load location.'))
      }
      return call.result?.items?.[0] ?? null
    },
  })

  const parentLocationQuery = useQuery({
    queryKey: ['wms-location-detail', 'parent', locationQuery.data?.parent_id],
    enabled: Boolean(locationQuery.data?.parent_id),
    queryFn: async () => {
      const parentId = locationQuery.data?.parent_id?.trim()
      if (!parentId) return null
      const params = new URLSearchParams({ ids: parentId, page: '1', pageSize: '1' })
      const call = await apiCall<PagedResponse<LocationRow>>(`/api/wms/locations?${params.toString()}`)
      if (!call.ok) return null
      return call.result?.items?.[0] ?? null
    },
  })

  const balancesQuery = useQuery({
    queryKey: ['wms-location-detail', 'balances', scopedLocationId],
    enabled: Boolean(scopedLocationId),
    queryFn: async () => {
      const params = new URLSearchParams({
        locationId: scopedLocationId!,
        page: '1',
        pageSize: '100',
        sortField: 'updatedAt',
        sortDir: 'desc',
      })
      const call = await apiCall<PagedResponse<InventoryBalanceRow>>(
        `/api/wms/inventory/balances?${params.toString()}`,
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.location.errors.balances', 'Failed to load items in location.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const variantIds = React.useMemo(() => {
    const ids = new Set<string>()
    for (const row of balancesQuery.data?.items ?? []) {
      const variantId = row.catalog_variant_id?.trim()
      if (variantId) ids.add(variantId)
    }
    return Array.from(ids)
  }, [balancesQuery.data?.items])

  const profilesQuery = useQuery({
    queryKey: ['wms-location-detail', 'profiles', variantIds],
    enabled: variantIds.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const call = await apiCall<PagedResponse<InventoryProfileRow>>(
        `/api/wms/inventory-profiles?${params.toString()}`,
      )
      if (!call.ok) return []
      return call.result?.items ?? []
    },
  })

  const lotsQuery = useQuery({
    queryKey: ['wms-location-detail', 'lots', variantIds],
    enabled: variantIds.length > 0,
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '100' })
      const call = await apiCall<PagedResponse<InventoryLotRow>>(`/api/wms/lots?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.location.errors.lots', 'Failed to load lots.'))
      }
      return call.result?.items ?? []
    },
  })

  const warehouseId = locationQuery.data?.warehouse_id?.trim() ?? ''

  const movementsQuery = useQuery({
    queryKey: ['wms-location-detail', 'movements', scopedLocationId, warehouseId],
    enabled: Boolean(scopedLocationId && warehouseId),
    queryFn: async () => {
      const params = new URLSearchParams({
        warehouseId,
        locationId: scopedLocationId!,
        page: '1',
        pageSize: '50',
        sortField: 'performedAt',
        sortDir: 'desc',
      })
      const call = await apiCall<PagedResponse<InventoryMovementRow>>(
        `/api/wms/inventory/movements?${params.toString()}`,
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.location.errors.movements', 'Failed to load recent activity.'))
      }
      return call.result?.items ?? []
    },
  })

  const lotById = React.useMemo(() => {
    const map = new Map<string, InventoryLotRow>()
    for (const lot of lotsQuery.data ?? []) {
      if (lot.id) map.set(lot.id, lot)
    }
    return map
  }, [lotsQuery.data])

  const reorderPointByVariant = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const profile of profilesQuery.data ?? []) {
      const variantId = profile.catalog_variant_id?.trim()
      if (!variantId) continue
      map.set(variantId, toNumber(profile.reorder_point))
    }
    return map
  }, [profilesQuery.data])

  const locationCode = (locationQuery.data?.code ?? '').trim() || scopedLocationId || '—'
  const pageTitle = locationCode

  const locationTypeLabel = React.useMemo(() => {
    const type = (locationQuery.data?.type ?? '').trim()
    if (!type) return null
    return t(`wms.backend.location.types.${type}`, type)
  }, [locationQuery.data?.type, t])

  const nowMs = Date.now()

  const totals = React.useMemo(() => {
    const items = balancesQuery.data?.items ?? []
    let onHand = 0
    let reserved = 0
    let allocated = 0
    const skuIds = new Set<string>()
    const lotIds = new Set<string>()
    for (const row of items) {
      onHand += toNumber(row.quantity_on_hand)
      reserved += toNumber(row.quantity_reserved)
      allocated += toNumber(row.quantity_allocated)
      const variantId = row.catalog_variant_id?.trim()
      if (variantId && toNumber(row.quantity_on_hand) > 0) skuIds.add(variantId)
      const lotId = row.lot_id?.trim()
      if (lotId && toNumber(row.quantity_on_hand) > 0) lotIds.add(lotId)
    }
    return {
      onHand,
      reserved,
      allocated,
      pendingPicks: reserved + allocated,
      skuCount: skuIds.size,
      lotCount: lotIds.size,
    }
  }, [balancesQuery.data?.items])

  const capacityUsedPercent = React.useMemo(() => {
    const capacity = toNumber(locationQuery.data?.capacity_units)
    if (capacity <= 0) return null
    return Math.min(100, Math.round((totals.onHand / capacity) * 100))
  }, [locationQuery.data?.capacity_units, totals.onHand])

  const lastCounted = React.useMemo(() => {
    const cycleMovements = (movementsQuery.data ?? []).filter((row) => row.type === 'cycle_count')
    if (cycleMovements.length === 0) return null
    const latest = cycleMovements[0]
    const raw = latest.performed_at ?? latest.received_at
    if (!raw) return null
    const ts = new Date(raw).getTime()
    if (Number.isNaN(ts)) return null
    return { ts, label: formatRelativeDays(ts, t) }
  }, [movementsQuery.data, t])

  const filteredBalances = React.useMemo(() => {
    const items = balancesQuery.data?.items ?? []
    return items.filter((row) =>
      matchesItemFilter(row, row.lot_id ? lotById.get(row.lot_id) : undefined, itemFilter, nowMs),
    )
  }, [balancesQuery.data?.items, itemFilter, lotById, nowMs])

  const itemsTotal = filteredBalances.length
  const itemsTotalPages = Math.max(1, Math.ceil(itemsTotal / itemsPageSize))
  const pagedBalances = React.useMemo(() => {
    const start = (itemsPage - 1) * itemsPageSize
    return filteredBalances.slice(start, start + itemsPageSize)
  }, [filteredBalances, itemsPage, itemsPageSize])

  React.useEffect(() => {
    setItemsPage(1)
    setSelectedBalanceIds(new Set())
  }, [itemFilter])

  const selectedBalances = React.useMemo(
    () => filteredBalances.filter((row) => selectedBalanceIds.has(row.id)),
    [filteredBalances, selectedBalanceIds],
  )

  const movementsHref = React.useMemo(() => {
    const params = new URLSearchParams()
    if (warehouseId) params.set('warehouseId', warehouseId)
    const query = params.toString()
    return query ? `/backend/wms/movements?${query}` : '/backend/wms/movements'
  }, [warehouseId])

  const inventoryConsoleHref = React.useMemo(() => {
    if (!scopedLocationId) return '/backend/wms/inventory'
    return `/backend/wms/inventory?locationId=${encodeURIComponent(scopedLocationId)}`
  }, [scopedLocationId])

  const locationsHref = '/backend/wms/locations'

  const openAdjustDialog = React.useCallback((preset: InventoryMutationPreset = {}) => {
    setAdjustPreset(preset)
    setAdjustOpen(true)
  }, [])

  const openCycleCountDialog = React.useCallback(
    (preset: Pick<InventoryMutationPreset, 'warehouseId' | 'locationId'> = {}) => {
      setCyclePreset(preset)
      setCycleOpen(true)
    },
    [],
  )

  const resolveMutationContext = React.useCallback((): InventoryMutationPreset => {
    const firstSelected = selectedBalances[0]
    const lotId =
      selectedBalances.length === 1 ? firstSelected?.lot_id?.trim() || undefined : undefined
    const catalogVariantId =
      selectedBalances.length === 1 ? firstSelected?.catalog_variant_id?.trim() || undefined : undefined
    return {
      warehouseId: warehouseId || undefined,
      locationId: scopedLocationId || undefined,
      catalogVariantId,
      lotId,
    }
  }, [scopedLocationId, selectedBalances, warehouseId])

  const toggleBalanceSelection = React.useCallback((balanceId: string, selected: boolean) => {
    setSelectedBalanceIds((current) => {
      const next = new Set(current)
      if (selected) next.add(balanceId)
      else next.delete(balanceId)
      return next
    })
  }, [])

  const togglePageSelection = React.useCallback((selected: boolean) => {
    setSelectedBalanceIds((current) => {
      const next = new Set(current)
      for (const row of pagedBalances) {
        if (selected) next.add(row.id)
        else next.delete(row.id)
      }
      return next
    })
  }, [pagedBalances])

  const pageSelectionState = React.useMemo(() => {
    if (pagedBalances.length === 0) {
      return { checked: false, indeterminate: false }
    }
    const selectedOnPage = pagedBalances.filter((row) => selectedBalanceIds.has(row.id)).length
    return {
      checked: selectedOnPage === pagedBalances.length,
      indeterminate: selectedOnPage > 0 && selectedOnPage < pagedBalances.length,
    }
  }, [pagedBalances, selectedBalanceIds])

  const handleExportItemsCsv = React.useCallback(() => {
    const headers = [
      t('wms.backend.location.items.columns.sku', 'SKU'),
      t('wms.backend.location.items.columns.variant', 'Variant name'),
      t('wms.backend.location.items.columns.lot', 'Lot'),
      t('wms.backend.location.items.columns.onHand', 'On hand'),
      t('wms.backend.location.items.columns.reserved', 'Reserved'),
      t('wms.backend.location.items.columns.status', 'Status'),
    ]
    const rows = filteredBalances.map((row) => {
      const lot = row.lot_id ? lotById.get(row.lot_id) : undefined
      const reorderPoint = reorderPointByVariant.get(row.catalog_variant_id?.trim() ?? '') ?? 0
      const status = resolveItemStatus(row, lot, reorderPoint, nowMs)
      return [
        formatSkuLabel(row),
        formatVariantName(row),
        formatLotLabel(lot, locale),
        String(toNumber(row.quantity_on_hand)),
        String(toNumber(row.quantity_reserved)),
        t(status.labelKey, status.labelFallback),
      ]
    })
    const safeCode = pageTitle.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'location'
    downloadCsvFile(`${safeCode}-items.csv`, [headers, ...rows])
  }, [filteredBalances, locale, lotById, nowMs, pageTitle, reorderPointByVariant, t])

  const warehouseLabel = formatWarehouseLabel(locationQuery.data ?? {})

  const subtitleParts = [
    locationTypeLabel ? `${locationTypeLabel} ${locationCode}` : null,
    parentLocationQuery.data?.code?.trim()
      ? t('wms.backend.location.header.zone', 'Zone {code}', {
          code: parentLocationQuery.data.code.trim(),
        })
      : null,
    warehouseLabel !== '—' ? warehouseLabel : null,
    locationQuery.data?.is_active === false
      ? t('wms.backend.location.header.inactive', 'Inactive')
      : t('wms.backend.location.header.active', 'Active'),
    lastCounted
      ? t('wms.backend.location.header.lastCounted', 'Last counted {when}', { when: lastCounted.label })
      : t('wms.backend.location.header.neverCounted', 'Never counted'),
  ].filter(Boolean)

  const itemColumns = React.useMemo<ColumnDef<InventoryBalanceRow>[]>(
    () => [
      {
        id: 'select',
        header: () => (
          <Checkbox
            aria-label={t('wms.backend.location.items.columns.select', 'Select')}
            checked={pageSelectionState.indeterminate ? 'indeterminate' : pageSelectionState.checked}
            onCheckedChange={(checked) => togglePageSelection(checked === true)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={t('wms.backend.location.items.columns.select', 'Select')}
            checked={selectedBalanceIds.has(row.original.id)}
            onCheckedChange={(checked) => toggleBalanceSelection(row.original.id, checked === true)}
          />
        ),
        meta: { maxWidth: '2.75rem' },
      },
      {
        accessorKey: 'variant_sku',
        header: t('wms.backend.location.items.columns.sku', 'SKU'),
        cell: ({ row }) => {
          const variantId = row.original.catalog_variant_id?.trim()
          const label = formatSkuLabel(row.original)
          if (!variantId) return label
          return (
            <Link
              href={`/backend/wms/sku/${encodeURIComponent(variantId)}`}
              className="font-medium text-primary hover:underline"
            >
              {label}
            </Link>
          )
        },
      },
      {
        accessorKey: 'variant_name',
        header: t('wms.backend.location.items.columns.variant', 'Variant name'),
        cell: ({ row }) => formatVariantName(row.original),
      },
      {
        accessorKey: 'lot_id',
        header: t('wms.backend.location.items.columns.lot', 'Lot'),
        cell: ({ row }) => {
          const lotId = row.original.lot_id?.trim()
          const lot = lotId ? lotById.get(lotId) : undefined
          const label = formatLotLabel(lot, locale)
          if (!lotId || label === '—') return label
          return (
            <Link
              href={`/backend/wms/lot/${encodeURIComponent(lotId)}`}
              className="font-medium text-primary hover:underline"
            >
              {label}
            </Link>
          )
        },
      },
      {
        accessorKey: 'quantity_on_hand',
        header: t('wms.backend.location.items.columns.onHand', 'On hand'),
        cell: ({ row }) => String(toNumber(row.original.quantity_on_hand)),
      },
      {
        accessorKey: 'quantity_reserved',
        header: t('wms.backend.location.items.columns.reserved', 'Reserved'),
        cell: ({ row }) => String(toNumber(row.original.quantity_reserved)),
      },
      {
        id: 'status',
        header: t('wms.backend.location.items.columns.status', 'Status'),
        cell: ({ row }) => {
          const lot = row.original.lot_id ? lotById.get(row.original.lot_id) : undefined
          const reorderPoint = reorderPointByVariant.get(row.original.catalog_variant_id?.trim() ?? '') ?? 0
          const status = resolveItemStatus(row.original, lot, reorderPoint, nowMs)
          return (
            <StatusBadge variant={status.variant} dot>
              {t(status.labelKey, status.labelFallback)}
            </StatusBadge>
          )
        },
      },
      {
        id: 'actions',
        header: '',
        cell: () => (
          <Button type="button" variant="ghost" size="icon" className="size-8" disabled aria-hidden>
            <MoreHorizontal className="size-4 text-muted-foreground" />
          </Button>
        ),
        meta: { maxWidth: '2.5rem' },
      },
    ],
    [
      locale,
      lotById,
      nowMs,
      pageSelectionState.checked,
      pageSelectionState.indeterminate,
      reorderPointByVariant,
      selectedBalanceIds,
      t,
      toggleBalanceSelection,
      togglePageSelection,
    ],
  )

  const activityColumns = React.useMemo<ColumnDef<InventoryMovementRow>[]>(
    () => [
      {
        accessorKey: 'type',
        header: t('wms.backend.location.activity.columns.event', 'Event'),
        cell: ({ row }) => {
          const type = row.original.type ?? 'movement'
          return (
            <StatusBadge variant={movementStatusMap[type] ?? 'neutral'}>
              {movementTypeLabel(type, t)}
            </StatusBadge>
          )
        },
      },
      {
        id: 'details',
        header: t('wms.backend.location.activity.columns.details', 'Details'),
        cell: ({ row }) => {
          const skuLabel =
            (row.original.variant_sku ?? '').trim() ||
            (row.original.variant_name ?? '').trim() ||
            row.original.catalog_variant_id ||
            '—'
          const subtitle = formatMovementSubtitle(row.original)
          return (
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{formatMovementTitle(row.original, skuLabel, t)}</p>
              {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
            </div>
          )
        },
      },
      {
        id: 'location',
        header: t('wms.backend.location.activity.columns.location', 'Location'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatMovementLocation(row.original, scopedLocationId ?? '', locationCode)}
          </span>
        ),
      },
      {
        id: 'time',
        header: t('wms.backend.location.activity.columns.time', 'Time'),
        cell: ({ row }) => {
          const raw = row.original.performed_at ?? row.original.received_at
          if (!raw) return '—'
          const date = new Date(raw)
          if (Number.isNaN(date.getTime())) return raw
          return activityTimeFormatter.format(date)
        },
        meta: { maxWidth: '6rem' },
      },
    ],
    [activityTimeFormatter, locationCode, scopedLocationId, t],
  )

  const filterChips: Array<{ id: ItemFilter; label: string }> = [
    { id: 'all', label: t('wms.backend.location.items.filters.all', 'All items') },
    { id: 'sellable', label: t('wms.backend.location.items.filters.sellable', 'Sellable') },
    { id: 'picking', label: t('wms.backend.location.items.filters.picking', 'Picking') },
    { id: 'nearExpiry', label: t('wms.backend.location.items.filters.nearExpiry', 'Near expiry') },
  ]

  const isLoading =
    locationQuery.isLoading ||
    balancesQuery.isLoading ||
    lotsQuery.isLoading ||
    movementsQuery.isLoading ||
    parentLocationQuery.isLoading

  const hasError =
    locationQuery.isError ||
    balancesQuery.isError ||
    lotsQuery.isError ||
    movementsQuery.isError

  if (!scopedLocationId) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t('wms.backend.location.errors.invalidId', 'Invalid location identifier.')}
            action={(
              <Button type="button" variant="outline" size="sm" onClick={() => router.push(locationsHref)}>
                {t('wms.backend.location.actions.backToLocations', 'Back to locations')}
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody className="space-y-6">
        <LinkButton asChild variant="gray" size="sm" className="w-fit px-0 text-muted-foreground hover:text-foreground">
          <Link href={locationsHref}>
            <ArrowLeft className="size-4" />
            {t('wms.backend.location.actions.backToLocations', 'Back to locations')}
          </Link>
        </LinkButton>

        <PageHeader
          title={pageTitle}
          description={subtitleParts.join(' · ')}
          actions={(
            <>
              {warehouseId ? (
                <Select value={warehouseId} disabled>
                  <SelectTrigger className="w-full max-w-xs sm:w-56">
                    <Warehouse className="mr-2 size-4 shrink-0 text-muted-foreground" />
                    <SelectValue placeholder={warehouseLabel} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={warehouseId}>{warehouseLabel}</SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
              {access.canAdjust ? (
                <Button type="button" variant="outline" onClick={() => openAdjustDialog(resolveMutationContext())}>
                  <SlidersHorizontal className="size-4" />
                  {t('wms.backend.location.actions.adjust', 'Adjust stock')}
                </Button>
              ) : null}
            </>
          )}
        />

        {isLoading ? (
          <LoadingMessage label={t('wms.backend.location.loading', 'Loading location view…')} />
        ) : null}

        {hasError ? (
          <ErrorMessage label={t('wms.backend.location.errors.load', 'Failed to load location view.')} />
        ) : null}

        {!isLoading && !hasError && locationQuery.data ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <LocationKpiCard
                title={t('wms.backend.location.kpis.skusOccupied.title', 'SKUs occupied')}
                caption={t('wms.backend.location.kpis.skusOccupied.caption', 'Distinct variants with stock')}
                value={String(totals.skuCount)}
                badgeLabel={
                  totals.skuCount > 0
                    ? t('wms.backend.location.kpis.skusOccupied.badge', '{count} active', { count: totals.skuCount })
                    : null
                }
                badgeVariant="info"
                ctaLabel={t('wms.backend.location.kpis.skusOccupied.cta', 'View items')}
                ctaHref="#location-items"
              />
              <LocationKpiCard
                title={t('wms.backend.location.kpis.capacityUsed.title', 'Capacity used')}
                caption={t('wms.backend.location.kpis.capacityUsed.caption', 'On hand vs location capacity')}
                value={capacityUsedPercent === null ? '—' : `${capacityUsedPercent}%`}
                badgeLabel={
                  capacityUsedPercent !== null && capacityUsedPercent >= 80
                    ? t('wms.backend.location.kpis.capacityUsed.badgeHigh', 'Near limit')
                    : capacityUsedPercent !== null
                      ? t('wms.backend.location.kpis.capacityUsed.badgeOk', 'Within capacity')
                      : null
                }
                badgeVariant={capacityUsedPercent !== null && capacityUsedPercent >= 80 ? 'warning' : 'success'}
                ctaLabel={t('wms.backend.location.kpis.capacityUsed.cta', 'Edit location')}
                ctaHref="/backend/config/wms"
              />
              <LocationKpiCard
                title={t('wms.backend.location.kpis.activeLots.title', 'Active lots')}
                caption={t('wms.backend.location.kpis.activeLots.caption', 'Lots with on-hand quantity')}
                value={String(totals.lotCount)}
                badgeLabel={
                  totals.lotCount > 0
                    ? t('wms.backend.location.kpis.activeLots.badge', '{count} lots', { count: totals.lotCount })
                    : null
                }
                badgeVariant="neutral"
                ctaLabel={t('wms.backend.location.kpis.activeLots.cta', 'View items')}
                ctaHref="#location-items"
              />
              <LocationKpiCard
                title={t('wms.backend.location.kpis.pendingPicks.title', 'Pending picks')}
                caption={t('wms.backend.location.kpis.pendingPicks.caption', 'Reserved and allocated units')}
                value={String(totals.pendingPicks)}
                badgeLabel={
                  totals.pendingPicks > 0
                    ? t('wms.backend.location.kpis.pendingPicks.badge', '{count} units', { count: totals.pendingPicks })
                    : null
                }
                badgeVariant="info"
                ctaLabel={t('wms.backend.location.kpis.pendingPicks.cta', 'View reservations')}
                ctaHref="/backend/wms/reservations"
              />
              <LocationKpiCard
                title={t('wms.backend.location.kpis.lastCounted.title', 'Last counted')}
                caption={t('wms.backend.location.kpis.lastCounted.caption', 'Most recent cycle count')}
                value={lastCounted?.label ?? '—'}
                badgeLabel={
                  lastCounted && Date.now() - lastCounted.ts > 14 * 24 * 60 * 60 * 1000
                    ? t('wms.backend.location.kpis.lastCounted.badgeStale', 'Due soon')
                    : lastCounted
                      ? t('wms.backend.location.kpis.lastCounted.badgeRecent', 'Recent')
                      : t('wms.backend.location.kpis.lastCounted.badgeNever', 'Never')
                }
                badgeVariant={
                  !lastCounted || Date.now() - (lastCounted?.ts ?? 0) > 14 * 24 * 60 * 60 * 1000
                    ? 'warning'
                    : 'success'
                }
                ctaLabel={t('wms.backend.location.kpis.lastCounted.cta', 'Start cycle count')}
                ctaHref="#location-items"
              />
            </section>

            <section
              id="location-items"
              className="rounded-lg border bg-card text-card-foreground shadow-sm"
            >
              <div className="border-b px-5 py-4">
                <h2 className="text-base font-semibold">
                  {t('wms.backend.location.items.title', 'Items in this location')}
                </h2>
              </div>
              <div className="flex flex-col gap-4 border-b px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  {filterChips.map((chip) => (
                    <Button
                      key={chip.id}
                      type="button"
                      size="sm"
                      variant={itemFilter === chip.id ? 'default' : 'outline'}
                      className={cn('rounded-full', itemFilter === chip.id && 'shadow-sm')}
                      onClick={() => setItemFilter(chip.id)}
                    >
                      {chip.label}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={handleExportItemsCsv}>
                    <Download className="size-4" />
                    {t('wms.backend.location.items.actions.exportCsv', 'Export CSV')}
                  </Button>
                  {access.canCycleCount ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        openCycleCountDialog({
                          warehouseId: warehouseId || undefined,
                          locationId: scopedLocationId,
                        })
                      }
                    >
                      {t('wms.backend.location.items.actions.cycleCountZone', 'Cycle count zone')}
                    </Button>
                  ) : null}
                  {access.canAdjust ? (
                    <Button
                      type="button"
                      variant="default"
                      disabled={selectedBalances.length === 0}
                      onClick={() => openAdjustDialog(resolveMutationContext())}
                    >
                      {t('wms.backend.location.items.actions.adjustSelected', 'Adjust selected')}
                    </Button>
                  ) : null}
                </div>
              </div>
              <DataTable<InventoryBalanceRow>
                embedded
                columns={itemColumns}
                data={pagedBalances}
                disableRowClick
                entityId={E.wms.inventory_balance}
                perspective={{ tableId: 'wms.location.items' }}
                pagination={{
                  page: itemsPage,
                  pageSize: itemsPageSize,
                  total: itemsTotal,
                  totalPages: itemsTotalPages,
                  onPageChange: setItemsPage,
                }}
                emptyState={(
                  <EmptyState
                    title={t('wms.backend.location.items.empty.title', 'No items in this view')}
                    description={t(
                      'wms.backend.location.items.empty.description',
                      'Try another filter or post inventory through receipts or adjustments.',
                    )}
                  />
                )}
              />
              {itemsTotal > 0 ? (
                <div className="flex flex-col gap-2 border-t px-5 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {t('wms.backend.location.items.footer.showing', 'Showing {shown} of {total} items', {
                      shown: pagedBalances.length,
                      total: itemsTotal,
                    })}
                  </span>
                  {balancesQuery.data && balancesQuery.data.total > itemsTotal ? (
                    <LinkButton asChild variant="gray" size="sm" className="h-auto px-0">
                      <Link href={inventoryConsoleHref}>
                        {t('wms.backend.location.items.footer.viewAll', 'View all items →')}
                      </Link>
                    </LinkButton>
                  ) : null}
                </div>
              ) : null}
            </section>

            <DataTable<InventoryMovementRow>
              title={t('wms.backend.location.activity.title', 'Recent activity')}
              columns={activityColumns}
              data={movementsQuery.data ?? []}
              disableRowClick
              entityId={E.wms.inventory_movement}
              perspective={{ tableId: 'wms.location.activity' }}
              emptyState={t('wms.backend.location.activity.empty', 'No recent movements for this location.')}
              actions={(
                <Button asChild type="button" variant="ghost" size="sm">
                  <Link href={movementsHref}>
                    {t('wms.backend.location.activity.viewAll', 'View all movements →')}
                  </Link>
                </Button>
              )}
            />

            <section className="flex flex-col gap-4 rounded-lg border bg-card px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold">
                  {t('wms.backend.location.quickActions.title', 'Quick actions')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'wms.backend.location.quickActions.description',
                    'Run common inventory actions without leaving this location view',
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {access.canAdjust ? (
                  <Button type="button" variant="default" onClick={() => openAdjustDialog(resolveMutationContext())}>
                    <SlidersHorizontal className="size-4" />
                    {t('wms.backend.location.quickActions.adjust', 'Adjust inventory')}
                  </Button>
                ) : null}
                {access.canAdjust ? (
                  <Button asChild type="button" variant="outline">
                    <Link href={inventoryConsoleHref}>
                      <ArrowLeftRight className="size-4" />
                      {t('wms.backend.location.quickActions.move', 'Move stock')}
                    </Link>
                  </Button>
                ) : null}
                {access.canCycleCount ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      openCycleCountDialog({
                        warehouseId: warehouseId || undefined,
                        locationId: scopedLocationId,
                      })
                    }
                  >
                    <ClipboardList className="size-4" />
                    {t('wms.backend.location.quickActions.cycleCount', 'Cycle count')}
                  </Button>
                ) : null}
                <Button asChild type="button" variant="outline">
                  <Link href={movementsHref}>
                    {t('wms.backend.location.quickActions.openLedger', 'Open ledger')}
                    <ExternalLink className="size-4" />
                  </Link>
                </Button>
              </div>
            </section>
          </>
        ) : null}

        {!isLoading && !hasError && !locationQuery.data ? (
          <ErrorMessage
            label={t('wms.backend.location.errors.notFound', 'Location not found.')}
            action={(
              <Button type="button" variant="outline" size="sm" onClick={() => router.push(locationsHref)}>
                {t('wms.backend.location.actions.backToLocations', 'Back to locations')}
              </Button>
            )}
          />
        ) : null}
      </PageBody>

      {access.canAdjust && scopedLocationId ? (
        <AdjustInventoryDialog
          open={adjustOpen}
          onOpenChange={setAdjustOpen}
          access={access}
          initialWarehouseId={adjustPreset.warehouseId ?? warehouseId}
          initialLocationId={adjustPreset.locationId ?? scopedLocationId}
          initialCatalogVariantId={adjustPreset.catalogVariantId}
          initialLotId={adjustPreset.lotId}
        />
      ) : null}
      {access.canCycleCount ? (
        <CycleCountWizardDialog
          open={cycleOpen}
          onOpenChange={setCycleOpen}
          access={access}
          initialWarehouseId={cyclePreset.warehouseId ?? warehouseId}
          initialLocationId={cyclePreset.locationId ?? scopedLocationId ?? undefined}
        />
      ) : null}
    </Page>
  )
}
