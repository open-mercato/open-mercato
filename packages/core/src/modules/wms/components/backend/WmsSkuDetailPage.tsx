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
  SlidersHorizontal,
  Warehouse,
} from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
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

const variantIdSchema = z.string().uuid()

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

type CatalogVariantRow = {
  id: string
  sku?: string | null
  name?: string | null
  is_active?: boolean | null
  created_at?: string | null
}

type InventoryProfileRow = {
  reorder_point?: string | number | null
  safety_stock?: string | number | null
}

type InventoryBalanceRow = {
  id: string
  warehouse_id?: string | null
  warehouse_name?: string | null
  warehouse_code?: string | null
  location_id?: string | null
  location_code?: string | null
  location_type?: string | null
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
  lotId?: string
}

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
type WarehouseOption = {
  id: string
  name?: string | null
  code?: string | null
}

type DistributionFilter = 'all' | 'sellable' | 'picking' | 'nearExpiry'

const NON_SELLABLE_LOCATION_TYPES = new Set(['staging', 'dock'])
const PICKING_LOCATION_TYPES = new Set(['staging', 'bin', 'slot'])
const NEAR_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000
const USAGE_WINDOW_DAYS = 14

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

function formatLocationLabel(code: string | null | undefined, id: string | null | undefined): string {
  const trimmed = (code ?? '').trim()
  if (trimmed) return trimmed
  return id || '—'
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

function resolveBalanceStatus(
  row: InventoryBalanceRow,
  lot: InventoryLotRow | undefined,
  reorderPoint: number,
  nowMs: number,
): { variant: StatusBadgeVariant; labelKey: string; labelFallback: string } {
  if (lot?.status === 'expired' || isExpired(lot?.expires_at, nowMs)) {
    return {
      variant: 'error',
      labelKey: 'wms.backend.sku.distribution.status.expired',
      labelFallback: 'Expired',
    }
  }
  if (isNearExpiry(lot?.expires_at, nowMs)) {
    return {
      variant: 'warning',
      labelKey: 'wms.backend.sku.distribution.status.nearExpiry',
      labelFallback: 'Near expiry',
    }
  }
  const available = row.quantity_available ?? 0
  if (reorderPoint > 0 && available <= reorderPoint) {
    return {
      variant: 'warning',
      labelKey: 'wms.backend.sku.distribution.status.lowStock',
      labelFallback: 'Low stock',
    }
  }
  const reserved = toNumber(row.quantity_reserved)
  const onHand = toNumber(row.quantity_on_hand)
  if (reserved > 0 && onHand > 0 && reserved >= onHand) {
    return {
      variant: 'info',
      labelKey: 'wms.backend.sku.distribution.status.reserved',
      labelFallback: 'Reserved',
    }
  }
  return {
    variant: 'success',
    labelKey: 'wms.backend.sku.distribution.status.available',
    labelFallback: 'Available',
  }
}

function matchesDistributionFilter(
  row: InventoryBalanceRow,
  lot: InventoryLotRow | undefined,
  filter: DistributionFilter,
  nowMs: number,
): boolean {
  const locationType = (row.location_type ?? '').trim().toLowerCase()
  const locationCode = (row.location_code ?? '').trim().toLowerCase()
  switch (filter) {
    case 'all':
      return true
    case 'sellable':
      return !NON_SELLABLE_LOCATION_TYPES.has(locationType)
    case 'picking':
      return (
        PICKING_LOCATION_TYPES.has(locationType) ||
        locationCode.includes('pick') ||
        locationCode.includes('staging')
      )
    case 'nearExpiry':
      return isNearExpiry(lot?.expires_at, nowMs) || lot?.status === 'expired'
    default:
      return true
  }
}

function movementTypeLabel(type: string, t: ReturnType<typeof useT>): string {
  const key = `wms.backend.sku.activity.types.${type}`
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

function formatMovementLocation(row: InventoryMovementRow): string {
  const warehouse = formatWarehouseLabel(row)
  const from = formatLocationLabel(row.location_from_code, row.location_from_id)
  const to = formatLocationLabel(row.location_to_code, row.location_to_id)
  if (row.type === 'transfer' && from !== '—' && to !== '—') return `${from} → ${to}`
  const location = to !== '—' ? to : from
  if (location !== '—') return `${warehouse} · ${location}`
  return warehouse
}

type SkuKpiCardProps = {
  title: string
  caption: string
  value: string
  badgeLabel: string | null
  badgeVariant: StatusBadgeVariant
  ctaLabel: string
  ctaHref: string
}

function SkuKpiCard({
  title,
  caption,
  value,
  badgeLabel,
  badgeVariant,
  ctaLabel,
  ctaHref,
}: SkuKpiCardProps) {
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

type WmsSkuDetailPageProps = {
  variantId: string
}

export default function WmsSkuDetailPage({ variantId }: WmsSkuDetailPageProps) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const access = useWmsInventoryMutationAccess()
  const parsedVariantId = variantIdSchema.safeParse(variantId.trim())
  const catalogVariantId = parsedVariantId.success ? parsedVariantId.data : null

  const [warehouseId, setWarehouseId] = React.useState<string>('all')
  const [distributionFilter, setDistributionFilter] = React.useState<DistributionFilter>('all')
  const [distributionPage, setDistributionPage] = React.useState(1)
  const [selectedBalanceIds, setSelectedBalanceIds] = React.useState<Set<string>>(() => new Set())
  const [adjustOpen, setAdjustOpen] = React.useState(false)
  const [adjustPreset, setAdjustPreset] = React.useState<InventoryMutationPreset>({})
  const [cycleOpen, setCycleOpen] = React.useState(false)
  const [cyclePreset, setCyclePreset] = React.useState<Pick<InventoryMutationPreset, 'warehouseId' | 'locationId'>>({})

  const distributionPageSize = 20

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

  const variantQuery = useQuery({
    queryKey: ['wms-sku-detail', 'variant', catalogVariantId],
    enabled: Boolean(catalogVariantId),
    queryFn: async () => {
      const params = new URLSearchParams({
        id: catalogVariantId!,
        page: '1',
        pageSize: '1',
      })
      const call = await apiCall<PagedResponse<CatalogVariantRow>>(
        `/api/catalog/variants?${params.toString()}`,
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.sku.errors.variant', 'Failed to load SKU.'))
      }
      return call.result?.items?.[0] ?? null
    },
  })

  const profileQuery = useQuery({
    queryKey: ['wms-sku-detail', 'profile', catalogVariantId],
    enabled: Boolean(catalogVariantId),
    queryFn: async () => {
      const params = new URLSearchParams({
        catalogVariantId: catalogVariantId!,
        page: '1',
        pageSize: '1',
      })
      const call = await apiCall<PagedResponse<InventoryProfileRow>>(
        `/api/wms/inventory-profiles?${params.toString()}`,
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.sku.errors.profile', 'Failed to load inventory profile.'))
      }
      return call.result?.items?.[0] ?? null
    },
  })

  const warehousesQuery = useQuery({
    queryKey: ['wms-sku-detail', 'warehouses'],
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '100', sortField: 'name', sortDir: 'asc' })
      const call = await apiCall<PagedResponse<WarehouseOption>>(`/api/wms/warehouses?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.sku.errors.warehouses', 'Failed to load warehouses.'))
      }
      return call.result?.items ?? []
    },
  })

  const balancesQuery = useQuery({
    queryKey: ['wms-sku-detail', 'balances', catalogVariantId, warehouseId],
    enabled: Boolean(catalogVariantId),
    queryFn: async () => {
      const params = new URLSearchParams({
        catalogVariantId: catalogVariantId!,
        page: '1',
        pageSize: '100',
        sortField: 'updatedAt',
        sortDir: 'desc',
      })
      if (warehouseId !== 'all') params.set('warehouseId', warehouseId)
      const call = await apiCall<PagedResponse<InventoryBalanceRow>>(
        `/api/wms/inventory/balances?${params.toString()}`,
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.sku.errors.balances', 'Failed to load stock distribution.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const lotsQuery = useQuery({
    queryKey: ['wms-sku-detail', 'lots', catalogVariantId],
    enabled: Boolean(catalogVariantId),
    queryFn: async () => {
      const params = new URLSearchParams({
        catalogVariantId: catalogVariantId!,
        page: '1',
        pageSize: '100',
      })
      const call = await apiCall<PagedResponse<InventoryLotRow>>(`/api/wms/lots?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.sku.errors.lots', 'Failed to load lots.'))
      }
      return call.result?.items ?? []
    },
  })

  const movementsQuery = useQuery({
    queryKey: ['wms-sku-detail', 'movements', catalogVariantId, warehouseId],
    enabled: Boolean(catalogVariantId),
    queryFn: async () => {
      const params = new URLSearchParams({
        catalogVariantId: catalogVariantId!,
        page: '1',
        pageSize: '25',
        sortField: 'performedAt',
        sortDir: 'desc',
      })
      if (warehouseId !== 'all') params.set('warehouseId', warehouseId)
      const call = await apiCall<PagedResponse<InventoryMovementRow>>(
        `/api/wms/inventory/movements?${params.toString()}`,
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.sku.errors.movements', 'Failed to load recent activity.'))
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

  const reorderPoint = toNumber(profileQuery.data?.reorder_point)
  const safetyStock = toNumber(profileQuery.data?.safety_stock)
  const skuLabel =
    (variantQuery.data?.sku ?? '').trim() ||
    (variantQuery.data?.name ?? '').trim() ||
    catalogVariantId ||
    '—'
  const variantName = (variantQuery.data?.name ?? '').trim()
  const pageTitle = (variantQuery.data?.sku ?? '').trim() || skuLabel

  const totals = React.useMemo(() => {
    const items = balancesQuery.data?.items ?? []
    let onHand = 0
    let reserved = 0
    let available = 0
    for (const row of items) {
      onHand += toNumber(row.quantity_on_hand)
      reserved += toNumber(row.quantity_reserved)
      available += row.quantity_available ?? 0
    }
    return { onHand, reserved, available }
  }, [balancesQuery.data?.items])

  const daysOfSupply = React.useMemo(() => {
    const movements = movementsQuery.data ?? []
    const windowStart = Date.now() - USAGE_WINDOW_DAYS * 24 * 60 * 60 * 1000
    let outbound = 0
    for (const row of movements) {
      const at = row.performed_at ?? row.received_at
      if (!at) continue
      const ts = new Date(at).getTime()
      if (Number.isNaN(ts) || ts < windowStart) continue
      if (row.type === 'pick' || row.type === 'pack' || row.type === 'ship') {
        outbound += Math.abs(toNumber(row.quantity))
      }
    }
    const daily = outbound / USAGE_WINDOW_DAYS
    if (daily <= 0 || totals.available <= 0) return null
    return Math.round(totals.available / daily)
  }, [movementsQuery.data, totals.available])

  const nowMs = React.useMemo(() => Date.now(), [])

  const filteredBalances = React.useMemo(() => {
    const items = balancesQuery.data?.items ?? []
    return items.filter((row) =>
      matchesDistributionFilter(row, row.lot_id ? lotById.get(row.lot_id) : undefined, distributionFilter, nowMs),
    )
  }, [balancesQuery.data?.items, distributionFilter, lotById, nowMs])

  const distributionTotal = filteredBalances.length
  const distributionTotalPages = Math.max(1, Math.ceil(distributionTotal / distributionPageSize))
  const pagedBalances = React.useMemo(() => {
    const start = (distributionPage - 1) * distributionPageSize
    return filteredBalances.slice(start, start + distributionPageSize)
  }, [distributionPage, distributionPageSize, filteredBalances])

  React.useEffect(() => {
    setDistributionPage(1)
    setSelectedBalanceIds(new Set())
  }, [distributionFilter, warehouseId])

  const selectedBalances = React.useMemo(
    () => filteredBalances.filter((row) => selectedBalanceIds.has(row.id)),
    [filteredBalances, selectedBalanceIds],
  )

  const movementsHref = React.useMemo(() => {
    const params = new URLSearchParams()
    if (catalogVariantId) params.set('catalogVariantId', catalogVariantId)
    if (warehouseId !== 'all') params.set('warehouseId', warehouseId)
    const query = params.toString()
    return query ? `/backend/wms/movements?${query}` : '/backend/wms/movements'
  }, [catalogVariantId, warehouseId])

  const inventoryConsoleHref = React.useMemo(() => {
    if (!catalogVariantId) return '/backend/wms/inventory'
    return `/backend/wms/inventory?catalogVariantId=${encodeURIComponent(catalogVariantId)}`
  }, [catalogVariantId])

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
    const scopedWarehouseId =
      firstSelected?.warehouse_id?.trim() ||
      (warehouseId !== 'all' ? warehouseId : undefined)
    const locationId =
      selectedBalances.length === 1 ? firstSelected?.location_id?.trim() || undefined : undefined
    const lotId =
      selectedBalances.length === 1 ? firstSelected?.lot_id?.trim() || undefined : undefined
    return {
      warehouseId: scopedWarehouseId,
      locationId,
      lotId,
    }
  }, [selectedBalances, warehouseId])

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

  const handleExportDistributionCsv = React.useCallback(() => {
    const headers = [
      t('wms.backend.sku.distribution.columns.warehouse', 'Warehouse'),
      t('wms.backend.sku.distribution.columns.location', 'Location'),
      t('wms.backend.sku.distribution.columns.lot', 'Lot'),
      t('wms.backend.sku.distribution.columns.onHand', 'On hand'),
      t('wms.backend.sku.distribution.columns.reserved', 'Reserved'),
      t('wms.backend.sku.distribution.columns.status', 'Status'),
    ]
    const rows = filteredBalances.map((row) => {
      const lot = row.lot_id ? lotById.get(row.lot_id) : undefined
      const status = resolveBalanceStatus(row, lot, reorderPoint, nowMs)
      return [
        formatWarehouseLabel(row),
        formatLocationLabel(row.location_code, row.location_id),
        formatLotLabel(lot, locale),
        String(toNumber(row.quantity_on_hand)),
        String(toNumber(row.quantity_reserved)),
        t(status.labelKey, status.labelFallback),
      ]
    })
    const safeSku = pageTitle.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'sku'
    downloadCsvFile(`${safeSku}-distribution.csv`, [headers, ...rows])
  }, [filteredBalances, locale, lotById, nowMs, pageTitle, reorderPoint, t])

  const inventoryHref = '/backend/wms/inventory'

  const selectedWarehouse = warehousesQuery.data?.find((warehouse) => warehouse.id === warehouseId)
  const warehouseLabel =
    warehouseId === 'all'
      ? t('wms.backend.sku.filters.allWarehouses', 'All warehouses')
      : selectedWarehouse?.name || selectedWarehouse?.code || warehouseId

  const subtitleParts = [
    variantName || null,
    variantQuery.data?.is_active === false
      ? t('wms.backend.sku.header.inactive', 'Inactive')
      : null,
  ].filter(Boolean)

  const distributionColumns = React.useMemo<ColumnDef<InventoryBalanceRow>[]>(
    () => [
      {
        id: 'select',
        header: () => (
          <Checkbox
            aria-label={t('wms.backend.sku.distribution.columns.select', 'Select')}
            checked={pageSelectionState.indeterminate ? 'indeterminate' : pageSelectionState.checked}
            onCheckedChange={(checked) => togglePageSelection(checked === true)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={t('wms.backend.sku.distribution.columns.select', 'Select')}
            checked={selectedBalanceIds.has(row.original.id)}
            onCheckedChange={(checked) => toggleBalanceSelection(row.original.id, checked === true)}
          />
        ),
        meta: { maxWidth: '2.75rem' },
      },
      {
        accessorKey: 'warehouse_id',
        header: t('wms.backend.sku.distribution.columns.warehouse', 'Warehouse'),
        cell: ({ row }) => formatWarehouseLabel(row.original),
      },
      {
        accessorKey: 'location_id',
        header: t('wms.backend.sku.distribution.columns.location', 'Location'),
        cell: ({ row }) => {
          const locationId = row.original.location_id?.trim()
          const label = formatLocationLabel(row.original.location_code, row.original.location_id)
          if (!locationId || label === '—') return label
          return (
            <Link
              href={`/backend/wms/location/${encodeURIComponent(locationId)}`}
              className="font-medium text-primary hover:underline"
            >
              {label}
            </Link>
          )
        },
      },
      {
        accessorKey: 'lot_id',
        header: t('wms.backend.sku.distribution.columns.lot', 'Lot'),
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
        header: t('wms.backend.sku.distribution.columns.onHand', 'On hand'),
        cell: ({ row }) => String(toNumber(row.original.quantity_on_hand)),
      },
      {
        accessorKey: 'quantity_reserved',
        header: t('wms.backend.sku.distribution.columns.reserved', 'Reserved'),
        cell: ({ row }) => String(toNumber(row.original.quantity_reserved)),
      },
      {
        id: 'status',
        header: t('wms.backend.sku.distribution.columns.status', 'Status'),
        cell: ({ row }) => {
          const lot = row.original.lot_id ? lotById.get(row.original.lot_id) : undefined
          const status = resolveBalanceStatus(row.original, lot, reorderPoint, nowMs)
          return (
            <StatusBadge variant={status.variant} dot>
              {t(status.labelKey, status.labelFallback)}
            </StatusBadge>
          )
        },
      },
    ],
    [
      locale,
      lotById,
      nowMs,
      pageSelectionState.checked,
      pageSelectionState.indeterminate,
      reorderPoint,
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
        header: t('wms.backend.sku.activity.columns.event', 'Event'),
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
        header: t('wms.backend.sku.activity.columns.details', 'Details'),
        cell: ({ row }) => {
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
        header: t('wms.backend.sku.activity.columns.location', 'Location'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatMovementLocation(row.original)}</span>
        ),
      },
      {
        id: 'time',
        header: t('wms.backend.sku.activity.columns.time', 'Time'),
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
    [activityTimeFormatter, skuLabel, t],
  )

  const filterChips: Array<{ id: DistributionFilter; label: string }> = [
    { id: 'all', label: t('wms.backend.sku.distribution.filters.all', 'All bins') },
    { id: 'sellable', label: t('wms.backend.sku.distribution.filters.sellable', 'Sellable') },
    { id: 'picking', label: t('wms.backend.sku.distribution.filters.picking', 'Picking') },
    { id: 'nearExpiry', label: t('wms.backend.sku.distribution.filters.nearExpiry', 'Near expiry') },
  ]

  const isLoading =
    variantQuery.isLoading ||
    profileQuery.isLoading ||
    balancesQuery.isLoading ||
    lotsQuery.isLoading ||
    movementsQuery.isLoading

  const hasError =
    variantQuery.isError ||
    profileQuery.isError ||
    balancesQuery.isError ||
    lotsQuery.isError ||
    movementsQuery.isError

  if (!catalogVariantId) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t('wms.backend.sku.errors.invalidId', 'Invalid SKU identifier.')}
            action={(
              <Button type="button" variant="outline" size="sm" onClick={() => router.push(inventoryHref)}>
                {t('wms.backend.sku.actions.backToInventory', 'Back to inventory')}
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
          <Link href={inventoryHref}>
            <ArrowLeft className="size-4" />
            {t('wms.backend.sku.actions.backToInventory', 'Back to inventory')}
          </Link>
        </LinkButton>

        <PageHeader
          title={pageTitle}
          description={subtitleParts.join(' · ')}
          actions={(
            <>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="w-full max-w-xs sm:w-56">
                  <Warehouse className="mr-2 size-4 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder={warehouseLabel} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t('wms.backend.sku.filters.allWarehouses', 'All warehouses')}
                  </SelectItem>
                  {(warehousesQuery.data ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name || warehouse.code || warehouse.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {access.canAdjust ? (
                <Button type="button" variant="outline" onClick={() => openAdjustDialog()}>
                  <SlidersHorizontal className="size-4" />
                  {t('wms.backend.sku.actions.adjust', 'Adjust stock')}
                </Button>
              ) : null}
            </>
          )}
        />

        {isLoading ? (
          <LoadingMessage label={t('wms.backend.sku.loading', 'Loading SKU view…')} />
        ) : null}

        {hasError ? (
          <ErrorMessage label={t('wms.backend.sku.errors.load', 'Failed to load SKU view.')} />
        ) : null}

        {!isLoading && !hasError && variantQuery.data ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <SkuKpiCard
                title={t('wms.backend.sku.kpis.onHand.title', 'On hand')}
                caption={t('wms.backend.sku.kpis.onHand.caption', 'Total physical quantity')}
                value={String(totals.onHand)}
                badgeLabel={
                  reorderPoint > 0 && totals.onHand <= reorderPoint
                    ? t('wms.backend.sku.kpis.onHand.badgeLow', 'Below reorder')
                    : null
                }
                badgeVariant="warning"
                ctaLabel={t('wms.backend.sku.kpis.onHand.cta', 'View distribution')}
                ctaHref="#stock-distribution"
              />
              <SkuKpiCard
                title={t('wms.backend.sku.kpis.reserved.title', 'Reserved')}
                caption={t('wms.backend.sku.kpis.reserved.caption', 'Committed to orders')}
                value={String(totals.reserved)}
                badgeLabel={
                  totals.reserved > 0
                    ? t('wms.backend.sku.kpis.reserved.badge', '{count} units held', { count: totals.reserved })
                    : null
                }
                badgeVariant="info"
                ctaLabel={t('wms.backend.sku.kpis.reserved.cta', 'View reservations')}
                ctaHref="/backend/wms/reservations"
              />
              <SkuKpiCard
                title={t('wms.backend.sku.kpis.available.title', 'Available')}
                caption={t('wms.backend.sku.kpis.available.caption', 'Ready to allocate')}
                value={String(totals.available)}
                badgeLabel={
                  totals.available > 0
                    ? t('wms.backend.sku.kpis.available.badge', 'Sellable')
                    : t('wms.backend.sku.kpis.available.badgeEmpty', 'None')
                }
                badgeVariant={totals.available > 0 ? 'success' : 'neutral'}
                ctaLabel={t('wms.backend.sku.kpis.available.cta', 'Adjust stock')}
                ctaHref={access.canAdjust ? '#stock-distribution' : inventoryHref}
              />
              <SkuKpiCard
                title={t('wms.backend.sku.kpis.reorderPoint.title', 'Reorder point')}
                caption={t('wms.backend.sku.kpis.reorderPoint.caption', 'From inventory profile')}
                value={String(reorderPoint)}
                badgeLabel={
                  safetyStock > 0
                    ? t('wms.backend.sku.kpis.reorderPoint.badgeSafety', 'Safety {count}', { count: safetyStock })
                    : null
                }
                badgeVariant={totals.available <= reorderPoint && reorderPoint > 0 ? 'error' : 'neutral'}
                ctaLabel={t('wms.backend.sku.kpis.reorderPoint.cta', 'Edit profile')}
                ctaHref="/backend/config/wms"
              />
              <SkuKpiCard
                title={t('wms.backend.sku.kpis.daysOfSupply.title', 'Days of supply')}
                caption={t('wms.backend.sku.kpis.daysOfSupply.caption', 'Based on last {days} days outbound', {
                  days: USAGE_WINDOW_DAYS,
                })}
                value={daysOfSupply === null ? '—' : String(daysOfSupply)}
                badgeLabel={
                  daysOfSupply !== null && daysOfSupply <= 7
                    ? t('wms.backend.sku.kpis.daysOfSupply.badgeShort', 'Short runway')
                    : null
                }
                badgeVariant="warning"
                ctaLabel={t('wms.backend.sku.kpis.daysOfSupply.cta', 'View movements')}
                ctaHref={movementsHref}
              />
            </section>

            <section
              id="stock-distribution"
              className="rounded-lg border bg-card text-card-foreground shadow-sm"
            >
              <div className="border-b px-5 py-4">
                <h2 className="text-base font-semibold">
                  {t('wms.backend.sku.distribution.title', 'Stock distribution')}
                </h2>
              </div>
              <div className="flex flex-col gap-4 border-b px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-2">
                  {filterChips.map((chip) => (
                    <Button
                      key={chip.id}
                      type="button"
                      size="sm"
                      variant={distributionFilter === chip.id ? 'default' : 'outline'}
                      className={cn('rounded-full', distributionFilter === chip.id && 'shadow-sm')}
                      onClick={() => setDistributionFilter(chip.id)}
                    >
                      {chip.label}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" onClick={handleExportDistributionCsv}>
                    <Download className="size-4" />
                    {t('wms.backend.sku.distribution.actions.exportCsv', 'Export CSV')}
                  </Button>
                  {access.canCycleCount ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => openCycleCountDialog(resolveMutationContext())}
                    >
                      {t('wms.backend.sku.distribution.actions.cycleCountZone', 'Cycle count zone')}
                    </Button>
                  ) : null}
                  {access.canAdjust && selectedBalances.length > 0 ? (
                    <Button
                      type="button"
                      variant="default"
                      onClick={() => openAdjustDialog(resolveMutationContext())}
                    >
                      {t('wms.backend.sku.distribution.actions.adjustSelected', 'Adjust selected ({count})', { count: selectedBalances.length })}
                    </Button>
                  ) : null}
                </div>
              </div>
              <DataTable<InventoryBalanceRow>
                embedded
                columns={distributionColumns}
                data={pagedBalances}
                disableRowClick
                entityId={E.wms.inventory_balance}
                perspective={{ tableId: 'wms.sku.distribution' }}
                pagination={{
                  page: distributionPage,
                  pageSize: distributionPageSize,
                  total: distributionTotal,
                  totalPages: distributionTotalPages,
                  onPageChange: setDistributionPage,
                }}
                emptyState={(
                  <EmptyState
                    title={t('wms.backend.sku.distribution.empty.title', 'No locations in this view')}
                    description={t(
                      'wms.backend.sku.distribution.empty.description',
                      'Try another filter or post inventory through receipts or adjustments.',
                    )}
                  />
                )}
              />
              {distributionTotal > 0 ? (
                <div className="flex flex-col gap-2 border-t px-5 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {t('wms.backend.sku.distribution.footer.showing', 'Showing {shown} of {total} locations', {
                      shown: pagedBalances.length,
                      total: distributionTotal,
                    })}
                  </span>
                  {balancesQuery.data && balancesQuery.data.total > distributionTotal ? (
                    <LinkButton asChild variant="gray" size="sm" className="h-auto px-0">
                      <Link href={inventoryHref}>
                        {t('wms.backend.sku.distribution.footer.viewAll', 'View all locations →')}
                      </Link>
                    </LinkButton>
                  ) : null}
                </div>
              ) : null}
            </section>

            <DataTable<InventoryMovementRow>
              title={t('wms.backend.sku.activity.title', 'Recent activity')}
              columns={activityColumns}
              data={movementsQuery.data ?? []}
              disableRowClick
              entityId={E.wms.inventory_movement}
              perspective={{ tableId: 'wms.sku.activity' }}
              emptyState={t('wms.backend.sku.activity.empty', 'No recent movements for this SKU.')}
              actions={(
                <Button asChild type="button" variant="ghost" size="sm">
                  <Link href={movementsHref}>
                    {t('wms.backend.sku.activity.viewAll', 'View all movements →')}
                  </Link>
                </Button>
              )}
            />

            <section className="flex flex-col gap-4 rounded-lg border bg-card px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold">
                  {t('wms.backend.sku.quickActions.title', 'Quick actions')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'wms.backend.sku.quickActions.description',
                    'Run common inventory actions without leaving this SKU view',
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {access.canAdjust ? (
                  <Button type="button" variant="default" onClick={() => openAdjustDialog()}>
                    <SlidersHorizontal className="size-4" />
                    {t('wms.backend.sku.quickActions.adjust', 'Adjust inventory')}
                  </Button>
                ) : null}
                {access.canAdjust ? (
                  <Button asChild type="button" variant="outline">
                    <Link href={inventoryConsoleHref}>
                      <ArrowLeftRight className="size-4" />
                      {t('wms.backend.sku.quickActions.move', 'Move stock')}
                    </Link>
                  </Button>
                ) : null}
                {access.canCycleCount ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => openCycleCountDialog(resolveMutationContext())}
                  >
                    <ClipboardList className="size-4" />
                    {t('wms.backend.sku.quickActions.cycleCount', 'Cycle count')}
                  </Button>
                ) : null}
                <Button asChild type="button" variant="outline">
                  <Link href={movementsHref}>
                    {t('wms.backend.sku.quickActions.openLedger', 'Open ledger')}
                    <ExternalLink className="size-4" />
                  </Link>
                </Button>
              </div>
            </section>
          </>
        ) : null}

        {!isLoading && !hasError && !variantQuery.data ? (
          <RecordNotFoundState
            label={t('wms.backend.sku.errors.notFound', 'SKU not found.')}
            backHref={inventoryHref}
            backLabel={t('wms.backend.sku.actions.backToInventory', 'Back to inventory')}
          />
        ) : null}
      </PageBody>

      {access.canAdjust && catalogVariantId ? (
        <AdjustInventoryDialog
          open={adjustOpen}
          onOpenChange={setAdjustOpen}
          access={access}
          initialCatalogVariantId={catalogVariantId}
          initialWarehouseId={adjustPreset.warehouseId}
          initialLocationId={adjustPreset.locationId}
          initialLotId={adjustPreset.lotId}
        />
      ) : null}
      {access.canCycleCount ? (
        <CycleCountWizardDialog
          open={cycleOpen}
          onOpenChange={setCycleOpen}
          access={access}
          initialCatalogVariantId={catalogVariantId ?? undefined}
          initialWarehouseId={cyclePreset.warehouseId}
          initialLocationId={cyclePreset.locationId}
        />
      ) : null}
    </Page>
  )
}
