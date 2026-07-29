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
import {
  inventoryMovementReasonLabel,
  type InventoryDisplayTranslator,
} from '../../lib/inventoryDisplayUi'
import { AdjustInventoryDialog } from './AdjustInventoryDialog'
import { ChangeLotStatusDialog } from './ChangeLotStatusDialog'
import { CycleCountWizardDialog } from './CycleCountWizardDialog'
import { useWmsInventoryMutationAccess } from './useWmsInventoryMutationAccess'

const lotIdSchema = z.string().uuid()

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
}

type CatalogVariantRow = {
  id: string
  sku?: string | null
  name?: string | null
}

type InventoryLotRow = {
  id: string
  catalog_variant_id?: string | null
  sku?: string | null
  lot_number?: string | null
  batch_number?: string | null
  manufactured_at?: string | null
  best_before_at?: string | null
  expires_at?: string | null
  status?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
  updated_at?: string | null
}

function extractLotStatusNotes(metadata: InventoryLotRow['metadata']): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const notes = metadata.notes
  return typeof notes === 'string' && notes.trim().length > 0 ? notes.trim() : null
}

type InventoryProfileRow = {
  reorder_point?: string | number | null
}

type InventoryBalanceRow = {
  id: string
  warehouse_id?: string | null
  warehouse_name?: string | null
  warehouse_code?: string | null
  location_id?: string | null
  location_code?: string | null
  location_type?: string | null
  catalog_variant_id?: string | null
  quantity_on_hand?: string | number | null
  quantity_reserved?: string | number | null
  quantity_allocated?: string | number | null
  quantity_available?: number | null
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
  lot_id?: string | null
  quantity?: string | number | null
  type?: string | null
  reference_type?: string | null
  reference_id?: string | null
  reason?: string | null
  reason_code?: string | null
  performed_at?: string | null
  received_at?: string | null
}

type InventoryMutationPreset = {
  warehouseId?: string
  locationId?: string
  catalogVariantId?: string
  lotId?: string
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
const MS_PER_DAY = 24 * 60 * 60 * 1000

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

function formatLocationLabel(code: string | null | undefined, id: string | null | undefined): string {
  const trimmed = (code ?? '').trim()
  if (trimmed) return trimmed
  return id || '—'
}

function balanceLocationKey(row: InventoryBalanceRow): string {
  return `${row.warehouse_id?.trim() ?? ''}:${row.location_id?.trim() ?? ''}`
}

function movementLocationKey(
  warehouseId: string | null | undefined,
  locationId: string | null | undefined,
): string {
  return `${warehouseId?.trim() ?? ''}:${locationId?.trim() ?? ''}`
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

function daysUntilExpiry(expiresAt: string | null | undefined, nowMs: number): number | null {
  if (!expiresAt) return null
  const expires = new Date(expiresAt).getTime()
  if (Number.isNaN(expires)) return null
  return Math.ceil((expires - nowMs) / MS_PER_DAY)
}

function daysSince(value: string | null | undefined, nowMs: number): number | null {
  if (!value) return null
  const ts = new Date(value).getTime()
  if (Number.isNaN(ts)) return null
  return Math.max(0, Math.floor((nowMs - ts) / MS_PER_DAY))
}

function resolveLotQualityStatus(
  status: string | null | undefined,
  expiresAt: string | null | undefined,
  nowMs: number,
): { variant: StatusBadgeVariant; labelKey: string; labelFallback: string; value: string } {
  if (status === 'expired' || isExpired(expiresAt, nowMs)) {
    return {
      variant: 'error',
      labelKey: 'wms.backend.lot.status.expired',
      labelFallback: 'Expired',
      value: 'Expired',
    }
  }
  if (status === 'quarantine') {
    return {
      variant: 'warning',
      labelKey: 'wms.backend.lot.status.quarantine',
      labelFallback: 'Quarantine',
      value: 'QC',
    }
  }
  if (status === 'hold') {
    return {
      variant: 'warning',
      labelKey: 'wms.backend.lot.status.hold',
      labelFallback: 'Hold',
      value: 'Hold',
    }
  }
  if (isNearExpiry(expiresAt, nowMs)) {
    return {
      variant: 'warning',
      labelKey: 'wms.backend.lot.status.nearExpiry',
      labelFallback: 'Near expiry',
      value: 'Near expiry',
    }
  }
  return {
    variant: 'success',
    labelKey: 'wms.backend.lot.status.available',
    labelFallback: 'Available',
    value: 'OK',
  }
}

function resolveBalanceStatus(
  row: InventoryBalanceRow,
  lot: InventoryLotRow | null | undefined,
  reorderPoint: number,
  nowMs: number,
): { variant: StatusBadgeVariant; labelKey: string; labelFallback: string } {
  if (lot?.status === 'expired' || isExpired(lot?.expires_at, nowMs)) {
    return {
      variant: 'error',
      labelKey: 'wms.backend.lot.distribution.status.expired',
      labelFallback: 'Expired',
    }
  }
  if (isNearExpiry(lot?.expires_at, nowMs)) {
    return {
      variant: 'warning',
      labelKey: 'wms.backend.lot.distribution.status.nearExpiry',
      labelFallback: 'Near expiry',
    }
  }
  const available = row.quantity_available ?? 0
  if (reorderPoint > 0 && available <= reorderPoint) {
    return {
      variant: 'warning',
      labelKey: 'wms.backend.lot.distribution.status.lowStock',
      labelFallback: 'Low stock',
    }
  }
  const reserved = toNumber(row.quantity_reserved)
  const onHand = toNumber(row.quantity_on_hand)
  if (reserved > 0 && onHand > 0 && reserved >= onHand) {
    return {
      variant: 'info',
      labelKey: 'wms.backend.lot.distribution.status.reserved',
      labelFallback: 'Reserved',
    }
  }
  return {
    variant: 'success',
    labelKey: 'wms.backend.lot.distribution.status.available',
    labelFallback: 'Available',
  }
}

function matchesDistributionFilter(
  row: InventoryBalanceRow,
  lot: InventoryLotRow | null | undefined,
  filter: DistributionFilter,
  nowMs: number,
): boolean {
  const locationType = (row.location_type ?? '').trim().toLowerCase()
  const locationCode = (row.location_code ?? '').trim().toLowerCase()
  switch (filter) {
    case 'all':
      return true
    case 'sellable':
      return !NON_SELLABLE_LOCATION_TYPES.has(locationType) && lot?.status !== 'expired'
    case 'picking':
      return (
        PICKING_LOCATION_TYPES.has(locationType) ||
        locationCode.includes('pick') ||
        locationCode.includes('staging') ||
        toNumber(row.quantity_reserved) > 0 ||
        toNumber(row.quantity_allocated) > 0
      )
    case 'nearExpiry':
      return isNearExpiry(lot?.expires_at, nowMs) || lot?.status === 'expired'
    default:
      return true
  }
}

function movementTypeLabel(type: string, t: ReturnType<typeof useT>): string {
  const key = `wms.backend.lot.activity.types.${type}`
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
  lotLabel: string,
  t: ReturnType<typeof useT>,
): string {
  const quantity = Math.abs(toNumber(row.quantity))
  const signedQuantity = toNumber(row.quantity)
  switch (row.type) {
    case 'receipt':
    case 'return_receive':
      return t('wms.backend.lot.activity.titles.received', 'Received {quantity}× {lot}', {
        quantity,
        lot: lotLabel,
      })
    case 'adjust':
      return t('wms.backend.lot.activity.titles.adjusted', 'Adjusted {quantity}× {lot}', {
        quantity: `${signedQuantity >= 0 ? '+' : ''}${signedQuantity}`,
        lot: lotLabel,
      })
    case 'transfer':
      return t('wms.backend.lot.activity.titles.moved', 'Moved {quantity}× {lot}', {
        quantity,
        lot: lotLabel,
      })
    case 'pick':
    case 'pack':
      return t('wms.backend.lot.activity.titles.allocated', 'Allocated {quantity}× {lot}', {
        quantity,
        lot: lotLabel,
      })
    case 'cycle_count':
      return t('wms.backend.lot.activity.titles.reconciled', 'Cycle count of {lot}', {
        lot: lotLabel,
      })
    default:
      return t('wms.backend.lot.activity.titles.generic', '{type} {quantity}× {lot}', {
        type: row.type ?? 'movement',
        quantity,
        lot: lotLabel,
      })
  }
}

function formatMovementSubtitle(
  row: InventoryMovementRow,
  t: InventoryDisplayTranslator,
): string | null {
  const reasonLabel = inventoryMovementReasonLabel(
    {
      reasonCode: row.reason_code,
      reason: row.reason,
      movementType: row.type,
    },
    t,
  )
  if (reasonLabel) return reasonLabel
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

function formatLastMoveLabel(
  raw: string | undefined,
  locale: string,
  t: ReturnType<typeof useT>,
): string {
  if (!raw) return '—'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const diffDays = Math.floor((Date.now() - date.getTime()) / MS_PER_DAY)
  if (diffDays === 0) {
    return t('wms.backend.lot.distribution.lastMove.today', '{time} today', {
      time: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date),
    })
  }
  if (diffDays === 1) {
    return t('wms.backend.lot.distribution.lastMove.yesterday', 'Yesterday')
  }
  if (diffDays < 7) {
    return t('wms.backend.lot.distribution.lastMove.daysAgo', '{days} days ago', { days: diffDays })
  }
  return new Intl.DateTimeFormat(locale, { month: '2-digit', day: '2-digit' }).format(date)
}

type LotKpiCardProps = {
  title: string
  caption: string
  value: string
  badgeLabel: string | null
  badgeVariant: StatusBadgeVariant
  ctaLabel: string
  ctaHref?: string
  onCtaClick?: () => void
}

function LotKpiCard({
  title,
  caption,
  value,
  badgeLabel,
  badgeVariant,
  ctaLabel,
  ctaHref,
  onCtaClick,
}: LotKpiCardProps) {
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
      {onCtaClick ? (
        <LinkButton variant="primary" size="sm" className="mt-auto pt-4 w-fit" onClick={onCtaClick}>
          {ctaLabel}
        </LinkButton>
      ) : ctaHref ? (
        <LinkButton asChild variant="primary" size="sm" className="mt-auto pt-4 w-fit">
          <Link href={ctaHref}>{ctaLabel}</Link>
        </LinkButton>
      ) : null}
    </section>
  )
}

type WmsLotDetailPageProps = {
  lotId: string
}

export default function WmsLotDetailPage({ lotId }: WmsLotDetailPageProps) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const access = useWmsInventoryMutationAccess()
  const parsedLotId = lotIdSchema.safeParse(lotId.trim())
  const scopedLotId = parsedLotId.success ? parsedLotId.data : null

  const [warehouseId, setWarehouseId] = React.useState<string>('all')
  const [distributionFilter, setDistributionFilter] = React.useState<DistributionFilter>('all')
  const [distributionPage, setDistributionPage] = React.useState(1)
  const [selectedBalanceIds, setSelectedBalanceIds] = React.useState<Set<string>>(() => new Set())
  const [adjustOpen, setAdjustOpen] = React.useState(false)
  const [adjustPreset, setAdjustPreset] = React.useState<InventoryMutationPreset>({})
  const [cycleOpen, setCycleOpen] = React.useState(false)
  const [cyclePreset, setCyclePreset] = React.useState<Pick<InventoryMutationPreset, 'warehouseId' | 'locationId'>>({})
  const [changeStatusOpen, setChangeStatusOpen] = React.useState(false)

  const distributionPageSize = 20
  const lotsHref = '/backend/wms/lots'
  const inventoryHref = '/backend/wms/inventory'

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

  const lotQuery = useQuery({
    queryKey: ['wms-lot-detail', 'lot', scopedLotId],
    enabled: Boolean(scopedLotId),
    queryFn: async () => {
      const params = new URLSearchParams({
        ids: scopedLotId!,
        page: '1',
        pageSize: '1',
      })
      const call = await apiCall<PagedResponse<InventoryLotRow>>(`/api/wms/lots?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.lot.errors.lot', 'Failed to load lot.'))
      }
      return call.result?.items?.[0] ?? null
    },
  })

  const catalogVariantId = lotQuery.data?.catalog_variant_id?.trim() ?? null

  const variantQuery = useQuery({
    queryKey: ['wms-lot-detail', 'variant', catalogVariantId],
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
        await raiseCrudError(call.response, t('wms.backend.lot.errors.variant', 'Failed to load SKU.'))
      }
      return call.result?.items?.[0] ?? null
    },
  })

  const profileQuery = useQuery({
    queryKey: ['wms-lot-detail', 'profile', catalogVariantId],
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
        await raiseCrudError(call.response, t('wms.backend.lot.errors.profile', 'Failed to load inventory profile.'))
      }
      return call.result?.items?.[0] ?? null
    },
  })

  const warehousesQuery = useQuery({
    queryKey: ['wms-lot-detail', 'warehouses'],
    queryFn: async () => {
      const params = new URLSearchParams({ page: '1', pageSize: '100', sortField: 'name', sortDir: 'asc' })
      const call = await apiCall<PagedResponse<WarehouseOption>>(`/api/wms/warehouses?${params.toString()}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.lot.errors.warehouses', 'Failed to load warehouses.'))
      }
      return call.result?.items ?? []
    },
  })

  const balancesQuery = useQuery({
    queryKey: ['wms-lot-detail', 'balances', scopedLotId, warehouseId],
    enabled: Boolean(scopedLotId),
    queryFn: async () => {
      const params = new URLSearchParams({
        lotId: scopedLotId!,
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
        await raiseCrudError(call.response, t('wms.backend.lot.errors.balances', 'Failed to load lot locations.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const movementsQuery = useQuery({
    queryKey: ['wms-lot-detail', 'movements', scopedLotId, warehouseId],
    enabled: Boolean(scopedLotId),
    queryFn: async () => {
      const params = new URLSearchParams({
        lotId: scopedLotId!,
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
        await raiseCrudError(call.response, t('wms.backend.lot.errors.movements', 'Failed to load recent activity.'))
      }
      return call.result?.items ?? []
    },
  })

  const reorderPoint = toNumber(profileQuery.data?.reorder_point)
  const lotData = lotQuery.data
  const lotLabel = (lotData?.lot_number ?? '').trim() || scopedLotId || '—'
  const skuLabel =
    (lotData?.sku ?? '').trim() ||
    (variantQuery.data?.sku ?? '').trim() ||
    catalogVariantId ||
    '—'
  const variantName = (variantQuery.data?.name ?? '').trim()
  const pageTitle = lotLabel
  const nowMs = React.useMemo(() => Date.now(), [])

  const qualityStatus = React.useMemo(
    () => resolveLotQualityStatus(lotData?.status, lotData?.expires_at, nowMs),
    [lotData?.expires_at, lotData?.status, nowMs],
  )
  const statusNotes = React.useMemo(
    () => extractLotStatusNotes(lotData?.metadata),
    [lotData?.metadata],
  )

  const daysToExpiry = daysUntilExpiry(lotData?.expires_at, nowMs)
  const lotAgeDays = daysSince(lotData?.created_at, nowMs)

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

  const lastMoveByLocation = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const row of movementsQuery.data ?? []) {
      const raw = row.performed_at ?? row.received_at
      if (!raw) continue
      const keys = [
        movementLocationKey(row.warehouse_id, row.location_to_id),
        movementLocationKey(row.warehouse_id, row.location_from_id),
      ]
      for (const key of keys) {
        if (!key || key === ':') continue
        const existing = map.get(key)
        if (!existing || new Date(raw).getTime() > new Date(existing).getTime()) {
          map.set(key, raw)
        }
      }
    }
    return map
  }, [movementsQuery.data])

  const filteredBalances = React.useMemo(() => {
    const items = balancesQuery.data?.items ?? []
    return items.filter((row) => matchesDistributionFilter(row, lotData, distributionFilter, nowMs))
  }, [balancesQuery.data?.items, distributionFilter, lotData, nowMs])

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
    if (scopedLotId) params.set('lotId', scopedLotId)
    if (warehouseId !== 'all') params.set('warehouseId', warehouseId)
    const query = params.toString()
    return query ? `/backend/wms/movements?${query}` : '/backend/wms/movements'
  }, [scopedLotId, warehouseId])

  const inventoryConsoleHref = React.useMemo(() => {
    if (!scopedLotId) return inventoryHref
    return `${inventoryHref}?lotId=${encodeURIComponent(scopedLotId)}`
  }, [scopedLotId])

  const skuDetailHref = catalogVariantId
    ? `/backend/wms/sku/${encodeURIComponent(catalogVariantId)}`
    : inventoryHref

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
    return {
      warehouseId: scopedWarehouseId,
      locationId,
      catalogVariantId: catalogVariantId ?? undefined,
      lotId: scopedLotId ?? undefined,
    }
  }, [catalogVariantId, scopedLotId, selectedBalances, warehouseId])

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
      t('wms.backend.lot.distribution.columns.warehouse', 'Warehouse'),
      t('wms.backend.lot.distribution.columns.location', 'Location'),
      t('wms.backend.lot.distribution.columns.lastMove', 'Last move'),
      t('wms.backend.lot.distribution.columns.onHand', 'On hand'),
      t('wms.backend.lot.distribution.columns.reserved', 'Reserved'),
      t('wms.backend.lot.distribution.columns.status', 'Status'),
    ]
    const rows = filteredBalances.map((row) => {
      const status = resolveBalanceStatus(row, lotData, reorderPoint, nowMs)
      return [
        formatWarehouseLabel(row),
        formatLocationLabel(row.location_code, row.location_id),
        formatLastMoveLabel(lastMoveByLocation.get(balanceLocationKey(row)), locale, t),
        String(toNumber(row.quantity_on_hand)),
        String(toNumber(row.quantity_reserved)),
        t(status.labelKey, status.labelFallback),
      ]
    })
    const safeLot = pageTitle.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'lot'
    downloadCsvFile(`${safeLot}-locations.csv`, [headers, ...rows])
  }, [filteredBalances, lastMoveByLocation, locale, lotData, nowMs, pageTitle, reorderPoint, t])

  const selectedWarehouse = warehousesQuery.data?.find((warehouse) => warehouse.id === warehouseId)
  const warehouseLabel =
    warehouseId === 'all'
      ? t('wms.backend.lot.filters.allWarehouses', 'All warehouses')
      : selectedWarehouse?.name || selectedWarehouse?.code || warehouseId

  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(locale, { year: 'numeric', month: '2-digit', day: '2-digit' }),
    [locale],
  )

  const subtitleParts = [
    skuLabel !== '—' ? skuLabel : null,
    variantName || null,
    lotData?.expires_at
      ? t('wms.backend.lot.header.expires', 'Exp {date}', {
          date: dateFormatter.format(new Date(lotData.expires_at)),
        })
      : null,
  ].filter(Boolean)

  const distributionColumns = React.useMemo<ColumnDef<InventoryBalanceRow>[]>(
    () => [
      {
        id: 'select',
        header: () => (
          <Checkbox
            aria-label={t('wms.backend.lot.distribution.columns.select', 'Select')}
            checked={pageSelectionState.indeterminate ? 'indeterminate' : pageSelectionState.checked}
            onCheckedChange={(checked) => togglePageSelection(checked === true)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label={t('wms.backend.lot.distribution.columns.select', 'Select')}
            checked={selectedBalanceIds.has(row.original.id)}
            onCheckedChange={(checked) => toggleBalanceSelection(row.original.id, checked === true)}
          />
        ),
        meta: { maxWidth: '2.75rem' },
      },
      {
        accessorKey: 'warehouse_id',
        header: t('wms.backend.lot.distribution.columns.warehouse', 'Warehouse'),
        cell: ({ row }) => formatWarehouseLabel(row.original),
      },
      {
        accessorKey: 'location_id',
        header: t('wms.backend.lot.distribution.columns.location', 'Location'),
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
        id: 'lastMove',
        header: t('wms.backend.lot.distribution.columns.lastMove', 'Last move'),
        cell: ({ row }) =>
          formatLastMoveLabel(lastMoveByLocation.get(balanceLocationKey(row.original)), locale, t),
      },
      {
        accessorKey: 'quantity_on_hand',
        header: t('wms.backend.lot.distribution.columns.onHand', 'On hand'),
        cell: ({ row }) => String(toNumber(row.original.quantity_on_hand)),
      },
      {
        accessorKey: 'quantity_reserved',
        header: t('wms.backend.lot.distribution.columns.reserved', 'Reserved'),
        cell: ({ row }) => String(toNumber(row.original.quantity_reserved)),
      },
      {
        id: 'status',
        header: t('wms.backend.lot.distribution.columns.status', 'Status'),
        cell: ({ row }) => {
          const status = resolveBalanceStatus(row.original, lotData, reorderPoint, nowMs)
          return (
            <StatusBadge variant={status.variant} dot>
              {t(status.labelKey, status.labelFallback)}
            </StatusBadge>
          )
        },
      },
    ],
    [
      lastMoveByLocation,
      locale,
      lotData,
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
        header: t('wms.backend.lot.activity.columns.event', 'Event'),
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
        header: t('wms.backend.lot.activity.columns.details', 'Details'),
        cell: ({ row }) => {
          const subtitle = formatMovementSubtitle(row.original, t)
          return (
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{formatMovementTitle(row.original, lotLabel, t)}</p>
              {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
            </div>
          )
        },
      },
      {
        id: 'location',
        header: t('wms.backend.lot.activity.columns.location', 'Location'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">{formatMovementLocation(row.original)}</span>
        ),
      },
      {
        id: 'time',
        header: t('wms.backend.lot.activity.columns.time', 'Time'),
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
    [activityTimeFormatter, lotLabel, t],
  )

  const filterChips: Array<{ id: DistributionFilter; label: string }> = [
    { id: 'all', label: t('wms.backend.lot.distribution.filters.all', 'All locations') },
    { id: 'sellable', label: t('wms.backend.lot.distribution.filters.sellable', 'Sellable') },
    { id: 'picking', label: t('wms.backend.lot.distribution.filters.picking', 'Picking') },
    { id: 'nearExpiry', label: t('wms.backend.lot.distribution.filters.nearExpiry', 'Near expiry') },
  ]

  const isLoading =
    lotQuery.isLoading ||
    variantQuery.isLoading ||
    profileQuery.isLoading ||
    balancesQuery.isLoading ||
    movementsQuery.isLoading

  const hasError =
    lotQuery.isError ||
    variantQuery.isError ||
    profileQuery.isError ||
    balancesQuery.isError ||
    movementsQuery.isError

  if (!scopedLotId) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t('wms.backend.lot.errors.invalidId', 'Invalid lot identifier.')}
            action={(
              <Button type="button" variant="outline" size="sm" onClick={() => router.push(lotsHref)}>
                {t('wms.backend.lot.actions.backToLots', 'Back to lots')}
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
          <Link href={lotsHref}>
            <ArrowLeft className="size-4" />
            {t('wms.backend.lot.actions.backToLots', 'Back to lots')}
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
                    {t('wms.backend.lot.filters.allWarehouses', 'All warehouses')}
                  </SelectItem>
                  {(warehousesQuery.data ?? []).map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name || warehouse.code || warehouse.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {access.canAdjust ? (
                <Button type="button" variant="outline" onClick={() => openAdjustDialog(resolveMutationContext())}>
                  <SlidersHorizontal className="size-4" />
                  {t('wms.backend.lot.actions.adjust', 'Adjust stock')}
                </Button>
              ) : null}
            </>
          )}
        />

        {isLoading ? (
          <LoadingMessage label={t('wms.backend.lot.loading', 'Loading lot view…')} />
        ) : null}

        {hasError ? (
          <ErrorMessage label={t('wms.backend.lot.errors.load', 'Failed to load lot view.')} />
        ) : null}

        {!isLoading && !hasError && lotQuery.data ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              <LotKpiCard
                title={t('wms.backend.lot.kpis.onHand.title', 'Total on hand')}
                caption={t('wms.backend.lot.kpis.onHand.caption', 'Physical quantity for this lot')}
                value={String(totals.onHand)}
                badgeLabel={
                  totals.onHand > 0
                    ? t('wms.backend.lot.kpis.onHand.badge', '{count} units', { count: totals.onHand })
                    : null
                }
                badgeVariant="info"
                ctaLabel={t('wms.backend.lot.kpis.onHand.cta', 'View locations')}
                ctaHref="#lot-locations"
              />
              <LotKpiCard
                title={t('wms.backend.lot.kpis.reserved.title', 'Reserved')}
                caption={t('wms.backend.lot.kpis.reserved.caption', 'Committed from this lot')}
                value={String(totals.reserved)}
                badgeLabel={
                  totals.reserved > 0
                    ? t('wms.backend.lot.kpis.reserved.badge', '{count} units held', { count: totals.reserved })
                    : null
                }
                badgeVariant="info"
                ctaLabel={t('wms.backend.lot.kpis.reserved.cta', 'View reservations')}
                ctaHref="/backend/wms/reservations"
              />
              <LotKpiCard
                title={t('wms.backend.lot.kpis.daysToExpiry.title', 'Days to expiry')}
                caption={t('wms.backend.lot.kpis.daysToExpiry.caption', 'Until expiration date')}
                value={daysToExpiry === null ? '—' : String(daysToExpiry)}
                badgeLabel={
                  daysToExpiry !== null && daysToExpiry <= 30
                    ? t('wms.backend.lot.kpis.daysToExpiry.badgeSoon', 'Expiring soon')
                    : daysToExpiry !== null
                      ? t('wms.backend.lot.kpis.daysToExpiry.badgeOk', 'Within window')
                      : null
                }
                badgeVariant={daysToExpiry !== null && daysToExpiry <= 30 ? 'warning' : 'success'}
                ctaLabel={t('wms.backend.lot.kpis.daysToExpiry.cta', 'View SKU profile')}
                ctaHref={skuDetailHref}
              />
              <LotKpiCard
                title={t('wms.backend.lot.kpis.lotAge.title', 'Lot age')}
                caption={t('wms.backend.lot.kpis.lotAge.caption', 'Since lot was created')}
                value={lotAgeDays === null ? '—' : t('wms.backend.lot.kpis.lotAge.value', '{days}d', { days: lotAgeDays })}
                badgeLabel={
                  lotAgeDays !== null && lotAgeDays <= 7
                    ? t('wms.backend.lot.kpis.lotAge.badgeFresh', 'Fresh lot')
                    : lotAgeDays !== null
                      ? t('wms.backend.lot.kpis.lotAge.badgeAged', 'Aged stock')
                      : null
                }
                badgeVariant={lotAgeDays !== null && lotAgeDays <= 7 ? 'success' : 'neutral'}
                ctaLabel={t('wms.backend.lot.kpis.lotAge.cta', 'View movements')}
                ctaHref={movementsHref}
              />
              <LotKpiCard
                title={t('wms.backend.lot.kpis.qualityStatus.title', 'Quality status')}
                caption={
                  statusNotes
                    ? t('wms.backend.lot.kpis.qualityStatus.notesCaption', 'Note: {notes}', {
                        notes: statusNotes,
                      })
                    : t('wms.backend.lot.kpis.qualityStatus.caption', 'Lot hold and QC state')
                }
                value={qualityStatus.value}
                badgeLabel={t(qualityStatus.labelKey, qualityStatus.labelFallback)}
                badgeVariant={qualityStatus.variant}
                ctaLabel={t('wms.backend.lot.kpis.qualityStatus.cta', 'Change status')}
                onCtaClick={access.canManage ? () => setChangeStatusOpen(true) : undefined}
                ctaHref={!access.canManage ? '/backend/config/wms' : undefined}
              />
            </section>

            <section
              id="lot-locations"
              className="rounded-lg border bg-card text-card-foreground shadow-sm"
            >
              <div className="border-b px-5 py-4">
                <h2 className="text-base font-semibold">
                  {t('wms.backend.lot.distribution.title', 'Where this lot lives')}
                </h2>
              </div>
              <div className="flex flex-col gap-4 border-b px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex flex-wrap gap-1.5">
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
                  <Button type="button" variant="outline" size="sm" onClick={handleExportDistributionCsv}>
                    <Download className="size-4" />
                    {t('wms.backend.lot.distribution.actions.exportCsv', 'Export CSV')}
                  </Button>
                  {access.canCycleCount ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openCycleCountDialog(resolveMutationContext())}
                    >
                      {t('wms.backend.lot.distribution.actions.cycleCountZone', 'Cycle count zone')}
                    </Button>
                  ) : null}
                  {access.canAdjust && selectedBalances.length > 0 ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      onClick={() => openAdjustDialog(resolveMutationContext())}
                    >
                      {t('wms.backend.lot.distribution.actions.adjustSelected', 'Adjust selected ({count})', { count: selectedBalances.length })}
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
                perspective={{ tableId: 'wms.lot.distribution' }}
                pagination={{
                  page: distributionPage,
                  pageSize: distributionPageSize,
                  total: distributionTotal,
                  totalPages: distributionTotalPages,
                  onPageChange: setDistributionPage,
                }}
                emptyState={(
                  <EmptyState
                    title={t('wms.backend.lot.distribution.empty.title', 'No locations in this view')}
                    description={t(
                      'wms.backend.lot.distribution.empty.description',
                      'Try another filter or post inventory through receipts or adjustments.',
                    )}
                  />
                )}
              />
              {distributionTotal > 0 ? (
                <div className="flex flex-col gap-2 border-t px-5 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {t('wms.backend.lot.distribution.footer.showing', 'Showing {shown} of {total} locations', {
                      shown: pagedBalances.length,
                      total: distributionTotal,
                    })}
                  </span>
                  <LinkButton asChild variant="gray" size="sm" className="h-auto px-0">
                    <Link href={movementsHref}>
                      {t('wms.backend.lot.distribution.footer.openLedger', 'Open ledger for this lot →')}
                    </Link>
                  </LinkButton>
                </div>
              ) : null}
            </section>

            <DataTable<InventoryMovementRow>
              title={t('wms.backend.lot.activity.title', 'Recent activity')}
              columns={activityColumns}
              data={movementsQuery.data ?? []}
              disableRowClick
              entityId={E.wms.inventory_movement}
              perspective={{ tableId: 'wms.lot.activity' }}
              emptyState={t('wms.backend.lot.activity.empty', 'No recent movements for this lot.')}
              actions={(
                <Button asChild type="button" variant="ghost" size="sm">
                  <Link href={movementsHref}>
                    {t('wms.backend.lot.activity.viewAll', 'View all movements →')}
                  </Link>
                </Button>
              )}
            />

            <section className="flex flex-col gap-4 rounded-lg border bg-card px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold">
                  {t('wms.backend.lot.quickActions.title', 'Quick actions')}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t(
                    'wms.backend.lot.quickActions.description',
                    'Run common inventory actions without leaving this lot view',
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {access.canAdjust ? (
                  <Button type="button" variant="default" onClick={() => openAdjustDialog(resolveMutationContext())}>
                    <SlidersHorizontal className="size-4" />
                    {t('wms.backend.lot.quickActions.adjust', 'Adjust inventory')}
                  </Button>
                ) : null}
                {access.canAdjust ? (
                  <Button asChild type="button" variant="outline">
                    <Link href={inventoryConsoleHref}>
                      <ArrowLeftRight className="size-4" />
                      {t('wms.backend.lot.quickActions.move', 'Move stock')}
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
                    {t('wms.backend.lot.quickActions.cycleCount', 'Cycle count')}
                  </Button>
                ) : null}
                <Button asChild type="button" variant="outline">
                  <Link href={movementsHref}>
                    {t('wms.backend.lot.quickActions.openLedger', 'Open ledger')}
                    <ExternalLink className="size-4" />
                  </Link>
                </Button>
              </div>
            </section>
          </>
        ) : null}

        {!isLoading && !hasError && !lotQuery.data ? (
          <RecordNotFoundState
            label={t('wms.backend.lot.errors.notFound', 'Lot not found.')}
            backHref={lotsHref}
            backLabel={t('wms.backend.lot.actions.backToLots', 'Back to lots')}
          />
        ) : null}
      </PageBody>

      {access.canAdjust && scopedLotId ? (
        <AdjustInventoryDialog
          open={adjustOpen}
          onOpenChange={setAdjustOpen}
          access={access}
          initialCatalogVariantId={adjustPreset.catalogVariantId ?? catalogVariantId ?? undefined}
          initialWarehouseId={adjustPreset.warehouseId}
          initialLocationId={adjustPreset.locationId}
          initialLotId={adjustPreset.lotId ?? scopedLotId}
        />
      ) : null}
      {access.canCycleCount ? (
        <CycleCountWizardDialog
          open={cycleOpen}
          onOpenChange={setCycleOpen}
          access={access}
          initialCatalogVariantId={catalogVariantId ?? undefined}
          initialWarehouseId={cyclePreset.warehouseId ?? (warehouseId !== 'all' ? warehouseId : undefined)}
          initialLocationId={cyclePreset.locationId}
          initialLotId={scopedLotId ?? undefined}
        />
      ) : null}
      {access.canAdjust && scopedLotId ? (
        <ChangeLotStatusDialog
          open={changeStatusOpen}
          onOpenChange={setChangeStatusOpen}
          access={access}
          lotId={scopedLotId}
          currentStatus={lotData?.status}
          lotUpdatedAt={lotData?.updated_at}
        />
      ) : null}
    </Page>
  )
}
