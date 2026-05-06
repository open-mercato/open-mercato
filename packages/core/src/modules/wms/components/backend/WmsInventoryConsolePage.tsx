"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Boxes, Route, ShieldCheck } from 'lucide-react'

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
  const name = (row.variant_name ?? '').trim()
  const sku = (row.variant_sku ?? '').trim()
  if (name && sku) return `${name} (${sku})`
  if (name) return name
  if (sku) return sku
  return row.catalog_variant_id || '—'
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
      {children}
    </section>
  )
}

function buildInventoryQuery(search: string, page: number, pageSize: number) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sortField: 'updatedAt',
    sortDir: 'desc',
  })
  if (search.trim()) params.set('search', search.trim())
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
  icon: React.ReactNode
  columns: ColumnDef<T>[]
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
  icon,
  columns,
}: InventoryDataTableSectionProps<T>) {
  const t = useT()
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')

  const params = React.useMemo(
    () => buildInventoryQuery(search, page, 20),
    [page, search],
  )

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
        emptyState={
          <EmptyState
            title={t(emptyTitleKey, emptyTitleFallback)}
            description={t(emptyDescriptionKey, emptyDescriptionFallback)}
          />
        }
      />
    </SectionCard>
  )
}

export function InventoryBalancesSection() {
  const t = useT()

  const columns = React.useMemo<ColumnDef<InventoryBalanceRow>[]>(
    () => [
      {
        accessorKey: 'catalog_variant_id',
        header: t('wms.backend.inventory.balances.columns.variant', 'Variant'),
        cell: ({ row }) => formatVariantLabel(row.original),
      },
      {
        accessorKey: 'warehouse_id',
        header: t(
          'wms.backend.inventory.balances.columns.warehouse',
          'Warehouse',
        ),
        cell: ({ row }) => formatWarehouseLabel(row.original),
      },
      {
        accessorKey: 'location_id',
        header: t(
          'wms.backend.inventory.balances.columns.location',
          'Location',
        ),
        cell: ({ row }) =>
          formatLocationLabel(row.original as Record<string, unknown>, 'location'),
      },
      {
        accessorKey: 'quantity_available',
        header: t(
          'wms.backend.inventory.balances.columns.available',
          'Available',
        ),
        cell: ({ row }) => String(row.original.quantity_available ?? 0),
      },
      {
        accessorKey: 'quantity_reserved',
        header: t(
          'wms.backend.inventory.balances.columns.reserved',
          'Reserved',
        ),
        cell: ({ row }) => String(row.original.quantity_reserved ?? 0),
      },
      {
        accessorKey: 'quantity_allocated',
        header: t(
          'wms.backend.inventory.balances.columns.allocated',
          'Allocated',
        ),
        cell: ({ row }) => String(row.original.quantity_allocated ?? 0),
      },
    ],
    [t],
  )

  return (
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
      icon={<Boxes className="size-5" />}
      columns={columns}
    />
  )
}

export function InventoryReservationsSection() {
  const t = useT()

  const columns = React.useMemo<ColumnDef<InventoryReservationRow>[]>(
    () => [
      {
        accessorKey: 'catalog_variant_id',
        header: t(
          'wms.backend.inventory.reservations.columns.variant',
          'Variant',
        ),
        cell: ({ row }) => formatVariantLabel(row.original),
      },
      {
        accessorKey: 'warehouse_id',
        header: t(
          'wms.backend.inventory.reservations.columns.warehouse',
          'Warehouse',
        ),
        cell: ({ row }) => formatWarehouseLabel(row.original),
      },
      {
        accessorKey: 'quantity',
        header: t(
          'wms.backend.inventory.reservations.columns.quantity',
          'Quantity',
        ),
        cell: ({ row }) => String(row.original.quantity ?? 0),
      },
      {
        accessorKey: 'source_type',
        header: t(
          'wms.backend.inventory.reservations.columns.sourceType',
          'Source type',
        ),
        cell: ({ row }) => row.original.source_type || '—',
      },
      {
        accessorKey: 'source_id',
        header: t(
          'wms.backend.inventory.reservations.columns.sourceId',
          'Source',
        ),
        cell: ({ row }) => row.original.source_id || '—',
      },
      {
        accessorKey: 'status',
        header: t(
          'wms.backend.inventory.reservations.columns.status',
          'Status',
        ),
        cell: ({ row }) => row.original.status || '—',
      },
    ],
    [t],
  )

  return (
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
      icon={<ShieldCheck className="size-5" />}
      columns={columns}
    />
  )
}

export function InventoryMovementsSection() {
  const t = useT()

  const columns = React.useMemo<ColumnDef<InventoryMovementRow>[]>(
    () => [
      {
        accessorKey: 'type',
        header: t('wms.backend.inventory.movements.columns.type', 'Type'),
        cell: ({ row }) => row.original.type || '—',
      },
      {
        accessorKey: 'catalog_variant_id',
        header: t(
          'wms.backend.inventory.movements.columns.variant',
          'Variant',
        ),
        cell: ({ row }) => formatVariantLabel(row.original),
      },
      {
        accessorKey: 'warehouse_id',
        header: t(
          'wms.backend.inventory.movements.columns.warehouse',
          'Warehouse',
        ),
        cell: ({ row }) => formatWarehouseLabel(row.original),
      },
      {
        accessorKey: 'location_from_id',
        header: t(
          'wms.backend.inventory.movements.columns.locationFrom',
          'From',
        ),
        cell: ({ row }) =>
          formatLocationLabel(row.original as Record<string, unknown>, 'location_from'),
      },
      {
        accessorKey: 'location_to_id',
        header: t(
          'wms.backend.inventory.movements.columns.locationTo',
          'To',
        ),
        cell: ({ row }) =>
          formatLocationLabel(row.original as Record<string, unknown>, 'location_to'),
      },
      {
        accessorKey: 'quantity',
        header: t(
          'wms.backend.inventory.movements.columns.quantity',
          'Quantity',
        ),
        cell: ({ row }) => String(row.original.quantity ?? 0),
      },
      {
        accessorKey: 'reference_type',
        header: t(
          'wms.backend.inventory.movements.columns.referenceType',
          'Reference type',
        ),
        cell: ({ row }) => row.original.reference_type || '—',
      },
      {
        accessorKey: 'performed_at',
        header: t(
          'wms.backend.inventory.movements.columns.performedAt',
          'Performed at',
        ),
        cell: ({ row }) =>
          row.original.performed_at || row.original.received_at || '—',
      },
    ],
    [t],
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
      icon={<Route className="size-5" />}
      columns={columns}
    />
  )
}

export default function WmsInventoryConsolePage() {
  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <InventoryBalancesSection />
          <InventoryReservationsSection />
          <InventoryMovementsSection />
        </div>
      </PageBody>
    </Page>
  )
}
