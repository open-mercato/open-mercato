"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Boxes, Package, Route, ShieldCheck, Warehouse as WarehouseIcon, X } from 'lucide-react'
import { E } from '#generated/entities.ids.generated'
import {
  createInventoryDateTimeFormatter,
  createInventoryQuantityFormatter,
  formatCatalogVariantLabel,
  formatInventoryDateTime,
  formatInventoryQuantity,
  formatReservationSourceLabel,
  inventoryMovementTypeLabel,
  inventoryReferenceTypeLabel,
  inventoryReservationSourceTypeLabel,
  inventoryReservationStatusLabel,
} from '../../lib/inventoryDisplayUi'
import { parseInventoryQuantity } from '../../lib/inventoryMutationUi'
import { ImportInventoryDialog } from './ImportInventoryDialog'
import { InventoryOperationsSection } from './InventoryOperationsSection'
import { MoveInventoryDialog } from './MoveInventoryDialog'
import { ReceiveInventoryDialog } from './ReceiveInventoryDialog'
import { ReleaseReservationDialog } from './ReleaseReservationDialog'
import {
  useWmsInventoryMutationAccess,
  type WmsInventoryMutationAccess,
} from './useWmsInventoryMutationAccess'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  loadCatalogVariantOptions,
  loadWarehouseOptions,
  resolveCatalogVariantLabel,
  resolveWarehouseLabel,
} from './inventoryMutationLoaders'
import { mergeLabelCacheEntries } from './wmsLookupLoaders'
import {
  useWmsInventoryScopeFromSearchParams,
  type WmsLowStockFilter,
} from './useWmsInventoryScopeFromSearchParams'

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
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
  variant_name?: string | null
  variant_sku?: string | null
  lot_id?: string | null
  quantity_on_hand?: string | number | null
  quantity_reserved?: string | number | null
  quantity_allocated?: string | number | null
  quantity_available?: number | null
}

type InventoryReservationRow = {
  id: string
  warehouse_id?: string | null
  warehouse_name?: string | null
  warehouse_code?: string | null
  catalog_variant_id?: string | null
  variant_name?: string | null
  variant_sku?: string | null
  quantity?: string | number | null
  source_type?: string | null
  source_id?: string | null
  source_label?: string | null
  status?: string | null
}

type InventoryMovementRow = {
  id: string
  warehouse_id?: string | null
  warehouse_name?: string | null
  warehouse_code?: string | null
  location_from_id?: string | null
  location_from_code?: string | null
  location_from_type?: string | null
  location_to_id?: string | null
  location_to_code?: string | null
  location_to_type?: string | null
  catalog_variant_id?: string | null
  variant_name?: string | null
  variant_sku?: string | null
  quantity?: string | number | null
  type?: string | null
  reference_type?: string | null
  reference_id?: string | null
  performed_at?: string | null
  received_at?: string | null
}

function formatVariantLabel(row: {
  variant_name?: string | null
  variant_sku?: string | null
  catalog_variant_id?: string | null
}): string {
  return formatCatalogVariantLabel(row)
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

const reservationStatusMap: Record<string, StatusBadgeVariant> = {
  active: 'info',
  released: 'neutral',
  fulfilled: 'success',
}

function useInventoryDisplayFormatters() {
  const locale = useLocale()
  const quantityFormatter = React.useMemo(
    () => createInventoryQuantityFormatter(locale),
    [locale],
  )
  const dateTimeFormatter = React.useMemo(
    () => createInventoryDateTimeFormatter(locale),
    [locale],
  )
  return { quantityFormatter, dateTimeFormatter }
}

function formatWarehouseLabel(row: {
  warehouse_name?: string | null
  warehouse_code?: string | null
  warehouse_id?: string | null
}): string {
  return (
    row.warehouse_name?.trim() ||
    row.warehouse_code?.trim() ||
    row.warehouse_id ||
    '—'
  )
}

function formatLocationLabel(
  row: Record<string, unknown>,
  prefix: 'location' | 'location_from' | 'location_to',
): string {
  const code = String((row[`${prefix}_code`] as string | null | undefined) ?? '').trim()
  if (code) return code
  const id = row[`${prefix}_id`]
  return typeof id === 'string' && id ? id : '—'
}

function SectionCard({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-md border bg-muted/40 p-2 text-muted-foreground">
          {icon}
        </div>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {/* `DataTable` in `embedded` mode omits its own scroll wrapper (shared
       * primitive behavior kept intact for other consumers), so this
       * WMS-local card provides horizontal scroll instead of clipping wide
       * tables. */}
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

function buildInventoryQuery(
  search: string,
  page: number,
  pageSize: number,
  sorting: SortingState,
  scope: {
    warehouseId: string
    variantId: string
    lotId: string
    lowStock: WmsLowStockFilter | null
  },
) {
  const sortCol = sorting[0]
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sortField: sortCol ? sortCol.id : 'updatedAt',
    sortDir: sortCol ? (sortCol.desc ? 'desc' : 'asc') : 'desc',
  })
  if (search.trim()) params.set('search', search.trim())
  if (scope.warehouseId.trim()) params.set('warehouseId', scope.warehouseId.trim())
  if (scope.variantId.trim()) params.set('catalogVariantId', scope.variantId.trim())
  if (scope.lotId.trim()) params.set('lotId', scope.lotId.trim())
  if (scope.lowStock) params.set('lowStock', scope.lowStock)
  return params.toString()
}

type InventoryDataTableSectionProps<T> = {
  sectionQueryKey: string
  endpoint: string
  titleKey: string
  titleFallback: string
  descriptionKey: string
  descriptionFallback: string
  errorKey: string
  errorFallback: string
  searchKey: string
  searchFallback: string
  emptyTitleKey: string
  emptyTitleFallback: string
  emptyDescriptionKey: string
  emptyDescriptionFallback: string
  tableId: string
  entityId: string
  icon: React.ReactNode
  columns: ColumnDef<T>[]
  rowActions?: (row: T) => React.ReactNode
  warehouseId?: string
  variantId?: string
  lotId?: string
  lowStock?: WmsLowStockFilter | null
  extraParams?: Record<string, string>
  toolbarActions?: React.ReactNode
  emptyStateAction?: React.ReactNode
}

function InventoryDataTableSection<T>({
  sectionQueryKey,
  endpoint,
  titleKey,
  titleFallback,
  descriptionKey,
  descriptionFallback,
  errorKey,
  errorFallback,
  searchKey,
  searchFallback,
  emptyTitleKey,
  emptyTitleFallback,
  emptyDescriptionKey,
  emptyDescriptionFallback,
  tableId,
  entityId,
  icon,
  columns,
  rowActions,
  warehouseId = '',
  variantId = '',
  lotId = '',
  lowStock = null,
  extraParams,
  toolbarActions,
  emptyStateAction,
}: InventoryDataTableSectionProps<T>) {
  const t = useT()
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([])

  const handleSortingChange = React.useCallback((nextSorting: SortingState) => {
    setSorting(nextSorting)
    setPage(1)
  }, [])

  const params = React.useMemo(() => {
    const base = buildInventoryQuery(search, page, 20, sorting, {
      warehouseId,
      variantId,
      lotId,
      lowStock,
    })
    if (!extraParams || Object.keys(extraParams).length === 0) return base
    const urlParams = new URLSearchParams(base)
    for (const [key, value] of Object.entries(extraParams)) {
      urlParams.set(key, value)
    }
    return urlParams.toString()
  }, [extraParams, lowStock, lotId, page, search, sorting, variantId, warehouseId])

  React.useEffect(() => {
    setPage(1)
  }, [warehouseId, variantId, lotId, lowStock])

  const query = useQuery({
    queryKey: ['wms-inventory-console', sectionQueryKey, params],
    queryFn: async () => {
      const call = await apiCall<PagedResponse<T>>(`${endpoint}?${params}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t(errorKey, errorFallback))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  return (
    <SectionCard
      title={t(titleKey, titleFallback)}
      description={t(descriptionKey, descriptionFallback)}
      icon={icon}
    >
      <DataTable
        embedded
        title={t(titleKey, titleFallback)}
        columns={columns}
        data={query.data?.items ?? []}
        isLoading={query.isLoading}
        error={query.isError ? t(errorKey, errorFallback) : null}
        entityId={entityId}
        searchValue={search}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchPlaceholder={t(searchKey, searchFallback)}
        pagination={{
          page,
          pageSize: 20,
          total: query.data?.total ?? 0,
          totalPages: query.data?.totalPages ?? 1,
          onPageChange: setPage,
        }}
        perspective={{ tableId }}
        sortable
        manualSorting
        sorting={sorting}
        onSortingChange={handleSortingChange}
        rowActions={rowActions}
        emptyState={
          <EmptyState
            title={t(emptyTitleKey, emptyTitleFallback)}
            description={t(emptyDescriptionKey, emptyDescriptionFallback)}
            actions={emptyStateAction}
          />
        }
        actions={toolbarActions}
      />
    </SectionCard>
  )
}

function InventoryScopeBar({
  warehouseId,
  variantId,
  onWarehouseChange,
  onVariantChange,
}: {
  warehouseId: string
  variantId: string
  onWarehouseChange: (id: string) => void
  onVariantChange: (id: string) => void
}) {
  const t = useT()
  const [warehouseLabelCache, setWarehouseLabelCache] = React.useState<Record<string, string>>({})
  const [variantLabelCache, setVariantLabelCache] = React.useState<Record<string, string>>({})
  const warehouseLabelCacheRef = React.useRef(warehouseLabelCache)
  warehouseLabelCacheRef.current = warehouseLabelCache
  const variantLabelCacheRef = React.useRef(variantLabelCache)
  variantLabelCacheRef.current = variantLabelCache

  React.useEffect(() => {
    if (!warehouseId.trim() || warehouseLabelCacheRef.current[warehouseId]) return
    let cancelled = false
    void resolveWarehouseLabel(warehouseId).then((label) => {
      if (cancelled || !label) return
      setWarehouseLabelCache((c) => ({ ...c, [warehouseId]: label }))
    })
    return () => { cancelled = true }
  }, [warehouseId])

  React.useEffect(() => {
    if (!variantId.trim() || variantLabelCacheRef.current[variantId]) return
    let cancelled = false
    void resolveCatalogVariantLabel(variantId).then((label) => {
      if (cancelled || !label) return
      setVariantLabelCache((c) => ({ ...c, [variantId]: label }))
    })
    return () => { cancelled = true }
  }, [variantId])

  // `mergeLabelCacheEntries` bails out with the same object reference when the
  // fetched options are already cached. Without that guard, every suggestion
  // fetch would produce a fresh object identity and re-render this component,
  // which recreates `loadSuggestions` and retriggers ComboboxInput's own
  // suggestion-fetch effect — looping indefinitely and starving the other
  // field's suggestions from ever loading.
  const loadWarehouseSuggestions = React.useCallback(async (query?: string) => {
    const options = await loadWarehouseOptions(query)
    setWarehouseLabelCache((c) => mergeLabelCacheEntries(c, options))
    return options.map((o) => ({ value: o.value, label: o.label }))
  }, [])

  const loadVariantSuggestions = React.useCallback(async (query?: string) => {
    const options = await loadCatalogVariantOptions(query)
    setVariantLabelCache((c) => mergeLabelCacheEntries(c, options))
    return options.map((o) => ({ value: o.value, label: o.label }))
  }, [])

  const hasScope = warehouseId.trim() || variantId.trim()

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <WarehouseIcon className="size-4 shrink-0" />
        <span className="text-sm font-medium">
          {t('wms.backend.inventory.console.scopeBar.label', 'Scope')}
        </span>
      </div>
      <div className="w-56">
        <ComboboxInput
          value={warehouseId}
          onChange={(next) => onWarehouseChange(next.trim())}
          loadSuggestions={loadWarehouseSuggestions}
          resolveLabel={(value) => warehouseLabelCache[value] ?? value}
          placeholder={t('wms.backend.inventory.console.scopeBar.allWarehouses', 'All warehouses')}
          allowCustomValues={false}
          clearable
        />
      </div>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Package className="size-4 shrink-0" />
      </div>
      <div className="w-56">
        <ComboboxInput
          value={variantId}
          onChange={(next) => onVariantChange(next.trim())}
          loadSuggestions={loadVariantSuggestions}
          resolveLabel={(value) => variantLabelCache[value] ?? value}
          placeholder={t('wms.backend.inventory.console.scopeBar.allVariants', 'All SKUs')}
          allowCustomValues={false}
          clearable
        />
      </div>
      {hasScope ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-2 py-1 text-xs"
          onClick={() => {
            onWarehouseChange('')
            onVariantChange('')
          }}
        >
          <X className="size-3" />
          {t('wms.backend.inventory.console.scopeBar.clearAll', 'Clear')}
        </Button>
      ) : null}
    </div>
  )
}

export function InventoryBalancesSection({
  access,
  warehouseId = '',
  variantId = '',
  lotId = '',
  lowStock = null,
}: {
  access: WmsInventoryMutationAccess
  warehouseId?: string
  variantId?: string
  lotId?: string
  lowStock?: WmsLowStockFilter | null
}) {
  const t = useT()
  const { quantityFormatter } = useInventoryDisplayFormatters()
  const [moveOpen, setMoveOpen] = React.useState(false)
  const [movePreset, setMovePreset] = React.useState<InventoryBalanceRow | null>(null)
  const [receiveOpen, setReceiveOpen] = React.useState(false)
  const [importOpen, setImportOpen] = React.useState(false)

  const openMoveDialog = React.useCallback((row: InventoryBalanceRow) => {
    setMovePreset(row)
    setMoveOpen(true)
  }, [])

  const columns = React.useMemo<ColumnDef<InventoryBalanceRow>[]>(
    () => [
      {
        accessorKey: 'catalog_variant_id',
        id: 'catalogVariantId',
        header: t('wms.backend.inventory.balances.columns.variant', 'Variant'),
        enableSorting: true,
        cell: ({ row }) => {
          const variantId = row.original.catalog_variant_id?.trim()
          const label = formatVariantLabel(row.original)
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
        accessorKey: 'warehouse_id',
        id: 'warehouseId',
        header: t(
          'wms.backend.inventory.balances.columns.warehouse',
          'Warehouse',
        ),
        enableSorting: true,
        cell: ({ row }) => formatWarehouseLabel(row.original),
      },
      {
        accessorKey: 'location_id',
        id: 'locationId',
        header: t(
          'wms.backend.inventory.balances.columns.location',
          'Location',
        ),
        enableSorting: true,
        cell: ({ row }) => {
          const locationId = row.original.location_id?.trim()
          const label = formatLocationLabel(row.original as Record<string, unknown>, 'location')
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
        header: t('wms.backend.inventory.balances.columns.lot', 'Lot'),
        enableSorting: false,
        cell: ({ row }) => {
          const lotId = row.original.lot_id?.trim()
          if (!lotId) return '—'
          return (
            <Link
              href={`/backend/wms/lot/${encodeURIComponent(lotId)}`}
              className="font-medium text-primary hover:underline"
            >
              {t('wms.backend.inventory.balances.lotLink', 'View lot')}
            </Link>
          )
        },
      },
      {
        accessorKey: 'quantity_available',
        id: 'quantityAvailable',
        header: t(
          'wms.backend.inventory.balances.columns.available',
          'Available',
        ),
        enableSorting: true,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatInventoryQuantity(row.original.quantity_available, quantityFormatter)}
          </span>
        ),
      },
      {
        accessorKey: 'quantity_reserved',
        id: 'quantityReserved',
        header: t(
          'wms.backend.inventory.balances.columns.reserved',
          'Reserved',
        ),
        enableSorting: true,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatInventoryQuantity(row.original.quantity_reserved, quantityFormatter)}
          </span>
        ),
      },
      {
        accessorKey: 'quantity_allocated',
        id: 'quantityAllocated',
        header: t(
          'wms.backend.inventory.balances.columns.allocated',
          'Allocated',
        ),
        enableSorting: true,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatInventoryQuantity(row.original.quantity_allocated, quantityFormatter)}
          </span>
        ),
      },
    ],
    [quantityFormatter, t],
  )

  const rowActions = React.useCallback(
    (row: InventoryBalanceRow) => {
      if (!access.canMove) return null
      const available = parseInventoryQuantity(row.quantity_available)
      if (available <= 0) return null
      return (
        <RowActions
          items={[
            {
              id: 'move',
              label: t('wms.backend.inventory.balances.actions.move', 'Move'),
              onSelect: () => openMoveDialog(row),
            },
          ]}
        />
      )
    },
    [access.canMove, openMoveDialog, t],
  )

  return (
    <>
      <InventoryDataTableSection<InventoryBalanceRow>
        sectionQueryKey="balances"
        endpoint="/api/wms/inventory/balances"
        titleKey="wms.backend.inventory.balances.title"
        titleFallback="Inventory balances"
        descriptionKey="wms.backend.inventory.balances.description"
        descriptionFallback="Current on-hand, reserved, allocated, and available quantities by bucket."
        errorKey="wms.backend.inventory.errors.balances"
        errorFallback="Failed to load balances."
        searchKey="wms.backend.inventory.balances.search"
        searchFallback="Search balances"
        emptyTitleKey="wms.backend.inventory.balances.empty.title"
        emptyTitleFallback="No balance buckets"
        emptyDescriptionKey="wms.backend.inventory.balances.empty.description"
        emptyDescriptionFallback="Balances appear after receipts, adjustments, or moves create inventory buckets."
        tableId="wms.inventory.balances"
        entityId={E.wms.inventory_balance}
        icon={<Boxes className="size-5" />}
        columns={columns}
        rowActions={rowActions}
        warehouseId={warehouseId}
        variantId={variantId}
        lotId={lotId}
        lowStock={lowStock}
        emptyStateAction={
          access.canReceive || access.canImport ? (
            <div className="flex flex-wrap items-center justify-center gap-2">
              {access.canReceive ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setReceiveOpen(true)}>
                  {t('wms.backend.inventory.balances.empty.receive', 'Receive stock')}
                </Button>
              ) : null}
              {access.canImport ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  {t('wms.backend.inventory.balances.empty.importCsv', 'Import CSV')}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />
      {access.canReceive ? (
        <ReceiveInventoryDialog
          open={receiveOpen}
          onOpenChange={setReceiveOpen}
          access={access}
        />
      ) : null}
      {access.canImport ? (
        <ImportInventoryDialog open={importOpen} onOpenChange={setImportOpen} access={access} />
      ) : null}
      {access.canMove ? (
        <MoveInventoryDialog
          open={moveOpen}
          onOpenChange={setMoveOpen}
          access={access}
          initialCatalogVariantId={movePreset?.catalog_variant_id ?? undefined}
          initialWarehouseId={movePreset?.warehouse_id ?? undefined}
          initialFromLocationId={movePreset?.location_id ?? undefined}
          initialLotId={movePreset?.lot_id ?? undefined}
          initialAvailable={movePreset ? parseInventoryQuantity(movePreset.quantity_available) : null}
          lockSourceContext
        />
      ) : null}
    </>
  )
}

export function InventoryReservationsSection({
  access,
  warehouseId = '',
  variantId = '',
  lotId = '',
}: {
  access: WmsInventoryMutationAccess
  warehouseId?: string
  variantId?: string
  lotId?: string
}) {
  const t = useT()
  const { quantityFormatter } = useInventoryDisplayFormatters()
  const [releaseOpen, setReleaseOpen] = React.useState(false)
  const [releasePreset, setReleasePreset] = React.useState<InventoryReservationRow | null>(null)
  const [activeOnly, setActiveOnly] = React.useState(true)

  const { runMutation: runAllocateMutation, retryLastMutation: retryAllocate } = useGuardedMutation({
    contextId: 'wms-inventory-allocate',
  })
  const allocateMutationContext = React.useMemo(
    () => ({ retryLastMutation: retryAllocate }),
    [retryAllocate],
  )

  const handleAllocate = React.useCallback(
    async (row: InventoryReservationRow) => {
      if (!access.organizationId || !access.tenantId || !row.id) return
      const payload = {
        organizationId: access.organizationId,
        tenantId: access.tenantId,
        reservationId: row.id,
      }
      try {
        await runAllocateMutation({
          operation: async () => {
            const call = await apiCall<{ ok?: boolean }>('/api/wms/inventory/allocate', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
            if (!call.ok) await raiseCrudError(call.response, t('wms.backend.inventory.allocate.errors.submit', 'Failed to allocate reservation.'))
            return call.result ?? {}
          },
          context: allocateMutationContext,
          mutationPayload: payload,
        })
        flash(t('wms.backend.inventory.allocate.flash.success', 'Reservation allocated'), 'success')
      } catch {
        flash(t('wms.backend.inventory.allocate.errors.submit', 'Failed to allocate reservation.'), 'error')
      }
    },
    [access.organizationId, access.tenantId, allocateMutationContext, runAllocateMutation, t],
  )

  const openReleaseDialog = React.useCallback((row: InventoryReservationRow) => {
    setReleasePreset(row)
    setReleaseOpen(true)
  }, [])

  const columns = React.useMemo<ColumnDef<InventoryReservationRow>[]>(
    () => [
      {
        accessorKey: 'catalog_variant_id',
        header: t(
          'wms.backend.inventory.reservations.columns.variant',
          'Variant',
        ),
        enableSorting: true,
        cell: ({ row }) => formatVariantLabel(row.original),
      },
      {
        accessorKey: 'warehouse_id',
        header: t(
          'wms.backend.inventory.reservations.columns.warehouse',
          'Warehouse',
        ),
        enableSorting: true,
        cell: ({ row }) => formatWarehouseLabel(row.original),
      },
      {
        accessorKey: 'quantity',
        header: t(
          'wms.backend.inventory.reservations.columns.quantity',
          'Quantity',
        ),
        enableSorting: true,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatInventoryQuantity(row.original.quantity, quantityFormatter)}
          </span>
        ),
      },
      {
        accessorKey: 'source_type',
        header: t(
          'wms.backend.inventory.reservations.columns.sourceType',
          'Source type',
        ),
        enableSorting: true,
        cell: ({ row }) => {
          const sourceType = row.original.source_type?.trim()
          if (!sourceType) return '—'
          return inventoryReservationSourceTypeLabel(sourceType, t)
        },
      },
      {
        accessorKey: 'source_id',
        header: t(
          'wms.backend.inventory.reservations.columns.sourceId',
          'Source',
        ),
        enableSorting: false,
        cell: ({ row }) => formatReservationSourceLabel(row.original, t),
      },
      {
        accessorKey: 'status',
        header: t(
          'wms.backend.inventory.reservations.columns.status',
          'Status',
        ),
        enableSorting: true,
        cell: ({ row }) => {
          const status = row.original.status?.trim()
          if (!status) return '—'
          return (
            <StatusBadge variant={reservationStatusMap[status] ?? 'neutral'} dot>
              {inventoryReservationStatusLabel(status, t)}
            </StatusBadge>
          )
        },
      },
    ],
    [quantityFormatter, t],
  )

  const rowActions = React.useCallback(
    (row: InventoryReservationRow) => {
      const status = (row.status ?? '').trim().toLowerCase()
      const items = []
      if (access.canAllocate && status === 'active') {
        items.push({
          id: 'allocate',
          label: t('wms.backend.inventory.reservations.actions.allocate', 'Allocate'),
          onSelect: () => void handleAllocate(row),
        })
      }
      if (access.canRelease && status === 'active') {
        items.push({
          id: 'release',
          label: t('wms.backend.inventory.reservations.actions.release', 'Release'),
          destructive: true,
          onSelect: () => openReleaseDialog(row),
        })
      }
      if (items.length === 0) return null
      return <RowActions items={items} />
    },
    [access.canAllocate, access.canRelease, handleAllocate, openReleaseDialog, t],
  )

  return (
    <>
      <InventoryDataTableSection<InventoryReservationRow>
        sectionQueryKey="reservations"
        endpoint="/api/wms/inventory/reservations"
        titleKey="wms.backend.inventory.reservations.title"
        titleFallback="Inventory reservations"
        descriptionKey="wms.backend.inventory.reservations.description"
        descriptionFallback="Active and historical reservation records created by manual API calls or sales lifecycle automation."
        errorKey="wms.backend.inventory.errors.reservations"
        errorFallback="Failed to load reservations."
        searchKey="wms.backend.inventory.reservations.search"
        searchFallback="Search reservations"
        emptyTitleKey="wms.backend.inventory.reservations.empty.title"
        emptyTitleFallback="No reservations"
        emptyDescriptionKey="wms.backend.inventory.reservations.empty.description"
        emptyDescriptionFallback="Reservations show stock committed to orders, transfers, or manual holds."
        tableId="wms.inventory.reservations"
        entityId={E.wms.inventory_reservation}
        icon={<ShieldCheck className="size-5" />}
        columns={columns}
        rowActions={rowActions}
        warehouseId={warehouseId}
        variantId={variantId}
        lotId={lotId}
        extraParams={activeOnly ? { status: 'active' } : undefined}
        toolbarActions={
          <Button
            type="button"
            variant={activeOnly ? 'outline' : 'ghost'}
            size="sm"
            onClick={() => setActiveOnly((prev) => !prev)}
          >
            {activeOnly
              ? t('wms.backend.inventory.reservations.filter.showAll', 'Show all')
              : t('wms.backend.inventory.reservations.filter.activeOnly', 'Active only')}
          </Button>
        }
      />
      {access.canRelease ? (
        <ReleaseReservationDialog
          open={releaseOpen}
          onOpenChange={setReleaseOpen}
          access={access}
          reservation={releasePreset}
        />
      ) : null}
    </>
  )
}

export function InventoryMovementsSection({
  warehouseId = '',
  variantId = '',
  lotId = '',
}: {
  warehouseId?: string
  variantId?: string
  lotId?: string
}) {
  const t = useT()
  const { quantityFormatter, dateTimeFormatter } = useInventoryDisplayFormatters()

  const columns = React.useMemo<ColumnDef<InventoryMovementRow>[]>(
    () => [
      {
        accessorKey: 'type',
        header: t('wms.backend.inventory.movements.columns.type', 'Type'),
        enableSorting: true,
        cell: ({ row }) => {
          const type = row.original.type?.trim()
          if (!type) return '—'
          return (
            <StatusBadge variant={movementStatusMap[type] ?? 'neutral'} dot>
              {inventoryMovementTypeLabel(type, t)}
            </StatusBadge>
          )
        },
      },
      {
        accessorKey: 'catalog_variant_id',
        header: t(
          'wms.backend.inventory.movements.columns.variant',
          'Variant',
        ),
        enableSorting: true,
        cell: ({ row }) => formatVariantLabel(row.original),
      },
      {
        accessorKey: 'warehouse_id',
        header: t(
          'wms.backend.inventory.movements.columns.warehouse',
          'Warehouse',
        ),
        enableSorting: true,
        cell: ({ row }) => formatWarehouseLabel(row.original),
      },
      {
        accessorKey: 'location_from_id',
        header: t(
          'wms.backend.inventory.movements.columns.locationFrom',
          'From',
        ),
        enableSorting: false,
        cell: ({ row }) =>
          formatLocationLabel(row.original as Record<string, unknown>, 'location_from'),
      },
      {
        accessorKey: 'location_to_id',
        header: t(
          'wms.backend.inventory.movements.columns.locationTo',
          'To',
        ),
        enableSorting: false,
        cell: ({ row }) =>
          formatLocationLabel(row.original as Record<string, unknown>, 'location_to'),
      },
      {
        accessorKey: 'quantity',
        header: t(
          'wms.backend.inventory.movements.columns.quantity',
          'Quantity',
        ),
        enableSorting: true,
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatInventoryQuantity(row.original.quantity, quantityFormatter)}
          </span>
        ),
      },
      {
        accessorKey: 'reference_type',
        header: t(
          'wms.backend.inventory.movements.columns.referenceType',
          'Reference type',
        ),
        enableSorting: true,
        cell: ({ row }) => {
          const referenceType = row.original.reference_type?.trim()
          if (!referenceType) return '—'
          return inventoryReferenceTypeLabel(referenceType, t)
        },
      },
      {
        accessorKey: 'performed_at',
        header: t(
          'wms.backend.inventory.movements.columns.performedAt',
          'Performed at',
        ),
        enableSorting: true,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatInventoryDateTime(
              row.original.performed_at || row.original.received_at,
              dateTimeFormatter,
            )}
          </span>
        ),
      },
    ],
    [dateTimeFormatter, quantityFormatter, t],
  )

  return (
    <InventoryDataTableSection<InventoryMovementRow>
      sectionQueryKey="movements"
      endpoint="/api/wms/inventory/movements"
      titleKey="wms.backend.inventory.movements.title"
      titleFallback="Inventory movement ledger"
      descriptionKey="wms.backend.inventory.movements.description"
      descriptionFallback="Immutable movement history for receipts, transfers, adjustments, and cycle counts."
      errorKey="wms.backend.inventory.errors.movements"
      errorFallback="Failed to load movements."
      searchKey="wms.backend.inventory.movements.search"
      searchFallback="Search movement ledger"
      emptyTitleKey="wms.backend.inventory.movements.empty.title"
      emptyTitleFallback="No inventory movements"
      emptyDescriptionKey="wms.backend.inventory.movements.empty.description"
      emptyDescriptionFallback="Movement rows are created by receipts, reservations, moves, and reconciliation actions."
      tableId="wms.inventory.movements"
      entityId={E.wms.inventory_movement}
      icon={<Route className="size-5" />}
      columns={columns}
      warehouseId={warehouseId}
      variantId={variantId}
      lotId={lotId}
    />
  )
}

export default function WmsInventoryConsolePage() {
  const access = useWmsInventoryMutationAccess()
  const scopeFromUrl = useWmsInventoryScopeFromSearchParams()
  const [warehouseId, setWarehouseId] = React.useState(scopeFromUrl.warehouseId)
  const [variantId, setVariantId] = React.useState(scopeFromUrl.catalogVariantId)
  const [lotId, setLotId] = React.useState(scopeFromUrl.lotId)
  const [lowStock, setLowStock] = React.useState(scopeFromUrl.lowStock)

  React.useEffect(() => {
    setWarehouseId(scopeFromUrl.warehouseId)
    setVariantId(scopeFromUrl.catalogVariantId)
    setLotId(scopeFromUrl.lotId)
    setLowStock(scopeFromUrl.lowStock)
  }, [scopeFromUrl.catalogVariantId, scopeFromUrl.warehouseId, scopeFromUrl.lotId, scopeFromUrl.lowStock])

  const handleWarehouseChange = React.useCallback((next: string) => {
    setWarehouseId(next)
    setLotId('')
    setLowStock(null)
  }, [])

  const handleVariantChange = React.useCallback((next: string) => {
    setVariantId(next)
    setLotId('')
    setLowStock(null)
  }, [])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <InventoryOperationsSection access={access} />
          <InventoryScopeBar
            warehouseId={warehouseId}
            variantId={variantId}
            onWarehouseChange={handleWarehouseChange}
            onVariantChange={handleVariantChange}
          />
          <InventoryBalancesSection
            access={access}
            warehouseId={warehouseId}
            variantId={variantId}
            lotId={lotId}
            lowStock={lowStock}
          />
          <InventoryReservationsSection
            access={access}
            warehouseId={warehouseId}
            variantId={variantId}
            lotId={lotId}
          />
          <InventoryMovementsSection
            warehouseId={warehouseId}
            variantId={variantId}
            lotId={lotId}
          />
        </div>
      </PageBody>
    </Page>
  )
}
