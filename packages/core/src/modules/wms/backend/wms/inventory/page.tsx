"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

const PAGE_SIZE = 20

type BalanceRow = {
  id: string
  warehouseId: string
  locationId: string
  catalogVariantId: string
  lotId: string | null
  serialNumber: string | null
  quantityOnHand: number
  quantityReserved: number
  quantityAllocated: number
  quantityAvailable: number
}

type BalancesResponse = {
  items: Array<Record<string, unknown>>
  total: number
  page: number
  totalPages: number
}

function mapApiRow(raw: Record<string, unknown>): BalanceRow {
  const onHand = typeof raw.quantityOnHand === 'number' ? raw.quantityOnHand : 0
  const reserved = typeof raw.quantityReserved === 'number' ? raw.quantityReserved : 0
  const allocated = typeof raw.quantityAllocated === 'number' ? raw.quantityAllocated : 0
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    warehouseId: typeof raw.warehouseId === 'string' ? raw.warehouseId : '',
    locationId: typeof raw.locationId === 'string' ? raw.locationId : '',
    catalogVariantId: typeof raw.catalogVariantId === 'string' ? raw.catalogVariantId : '',
    lotId: typeof raw.lotId === 'string' ? raw.lotId : null,
    serialNumber: typeof raw.serialNumber === 'string' ? raw.serialNumber : null,
    quantityOnHand: onHand,
    quantityReserved: reserved,
    quantityAllocated: allocated,
    quantityAvailable: onHand - reserved - allocated,
  }
}

export default function WmsInventoryPage() {
  const [rows, setRows] = React.useState<BalanceRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterWarehouseId, setFilterWarehouseId] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()

  const [warehouses, setWarehouses] = React.useState<Array<{ id: string; name: string; code: string }>>([])

  React.useEffect(() => {
    async function loadWarehouses() {
      try {
        const call = await apiCall<{ items: Array<Record<string, unknown>> }>(
          '/api/wms/warehouses?pageSize=100',
          undefined,
          { fallback: { items: [] } }
        )
        if (call.ok && call.result) {
          setWarehouses(
            (call.result.items ?? []).map((w) => ({
              id: typeof w.id === 'string' ? w.id : '',
              name: typeof w.name === 'string' ? w.name : '',
              code: typeof w.code === 'string' ? w.code : '',
            }))
          )
        }
      } catch { /* ignore */ }
    }
    loadWarehouses()
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
        })
        if (search.trim()) params.set('search', search.trim())
        if (filterWarehouseId) params.set('warehouseId', filterWarehouseId)
        const fallback: BalancesResponse = { items: [], total: 0, page: 1, totalPages: 1 }
        const call = await apiCall<BalancesResponse>(
          `/api/wms/inventory/balances?${params.toString()}`,
          undefined,
          { fallback }
        )
        if (!cancelled && call.ok && call.result) {
          const payload = call.result
          const items = Array.isArray(payload.items) ? payload.items : []
          setRows(items.map((item) => mapApiRow(item as Record<string, unknown>)))
          setTotal(payload.total ?? 0)
          setTotalPages(payload.totalPages ?? 1)
        }
      } catch {
        if (!cancelled) {
          flash(t('wms.inventory.list.error.load', 'Failed to load inventory.'), 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, search, filterWarehouseId, scopeVersion, t])

  const columns = React.useMemo<ColumnDef<BalanceRow>[]>(
    () => [
      {
        accessorKey: 'catalogVariantId',
        header: t('wms.inventory.list.columns.variant', 'Variant ID'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.catalogVariantId.slice(0, 8)}…</span>
        ),
        meta: { priority: 1 },
      },
      {
        accessorKey: 'warehouseId',
        header: t('wms.inventory.list.columns.warehouse', 'Warehouse'),
        cell: ({ row }) => {
          const w = warehouses.find((wh) => wh.id === row.original.warehouseId)
          return w ? `${w.name} (${w.code})` : row.original.warehouseId.slice(0, 8) + '…'
        },
        meta: { priority: 2 },
      },
      {
        accessorKey: 'locationId',
        header: t('wms.inventory.list.columns.location', 'Location'),
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.locationId.slice(0, 8)}…</span>
        ),
        meta: { priority: 3 },
      },
      {
        accessorKey: 'quantityOnHand',
        header: t('wms.inventory.list.columns.onHand', 'On Hand'),
        meta: { priority: 4 },
      },
      {
        accessorKey: 'quantityReserved',
        header: t('wms.inventory.list.columns.reserved', 'Reserved'),
        meta: { priority: 5 },
      },
      {
        accessorKey: 'quantityAllocated',
        header: t('wms.inventory.list.columns.allocated', 'Allocated'),
        meta: { priority: 6 },
      },
      {
        accessorKey: 'quantityAvailable',
        header: t('wms.inventory.list.columns.available', 'Available'),
        cell: ({ row }) => {
          const val = row.original.quantityAvailable
          return (
            <span className={val <= 0 ? 'font-semibold text-red-600' : 'text-green-700'}>
              {val}
            </span>
          )
        },
        meta: { priority: 7 },
      },
      {
        accessorKey: 'lotId',
        header: t('wms.inventory.list.columns.lot', 'Lot'),
        cell: ({ row }) => row.original.lotId ? row.original.lotId.slice(0, 8) + '…' : '—',
        meta: { priority: 8 },
      },
    ],
    [t, warehouses]
  )

  return (
    <Page>
      <PageHeader title={t('wms.inventory.list.title', 'Inventory')} />
      <PageBody>
        <div className="mb-4 flex gap-2">
          <select
            className="rounded border px-3 py-1.5 text-sm"
            value={filterWarehouseId}
            onChange={(e) => { setFilterWarehouseId(e.target.value); setPage(1) }}
          >
            <option value="">{t('wms.inventory.list.filter.allWarehouses', 'All warehouses')}</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
            ))}
          </select>
        </div>
        <DataTable<BalanceRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder={t('wms.inventory.list.search', 'Search inventory…')}
          searchValue={search}
          onSearchChange={setSearch}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
        />
      </PageBody>
    </Page>
  )
}
