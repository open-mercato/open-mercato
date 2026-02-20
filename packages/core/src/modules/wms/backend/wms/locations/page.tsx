"use client"

import * as React from 'react'
import Link from 'next/link'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useRouter } from 'next/navigation'

const PAGE_SIZE = 20
const LOCATION_TYPES = ['zone', 'aisle', 'rack', 'bin', 'slot', 'dock', 'staging']

type LocationRow = {
  id: string
  code: string
  type: string
  warehouseId: string
  isActive: boolean
  parentId?: string | null
  capacityUnits?: number | null
  capacityWeight?: number | null
}

type LocationsResponse = {
  items: Array<Record<string, unknown>>
  total: number
  page: number
  totalPages: number
}

function mapApiRow(raw: Record<string, unknown>): LocationRow {
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    code: typeof raw.code === 'string' ? raw.code : '',
    type: typeof raw.type === 'string' ? raw.type : '',
    warehouseId: typeof raw.warehouseId === 'string' ? raw.warehouseId : '',
    isActive: raw.isActive === true,
    parentId: typeof raw.parentId === 'string' ? raw.parentId : null,
    capacityUnits: typeof raw.capacityUnits === 'number' ? raw.capacityUnits : null,
    capacityWeight: typeof raw.capacityWeight === 'number' ? raw.capacityWeight : null,
  }
}

export default function WmsLocationsPage() {
  const [rows, setRows] = React.useState<LocationRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterType, setFilterType] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadKey, setReloadKey] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  const reload = React.useCallback(() => setReloadKey((k) => k + 1), [])

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
        if (filterType) params.set('type', filterType)
        const fallback: LocationsResponse = { items: [], total: 0, page: 1, totalPages: 1 }
        const call = await apiCall<LocationsResponse>(
          `/api/wms/locations?${params.toString()}`,
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
          flash(t('wms.locations.list.error.load', 'Failed to load locations.'), 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, search, filterType, scopeVersion, reloadKey, t])

  const handleDelete = React.useCallback(async (row: LocationRow) => {
    const confirmed = await confirm({
      title: t('wms.locations.delete.confirm', 'Are you sure you want to delete location "{code}"?', { code: row.code }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await deleteCrud('wms/locations', row.id)
      flash(t('wms.locations.delete.success', 'Location deleted.'), 'success')
      reload()
    } catch {
      flash(t('wms.locations.delete.error', 'Failed to delete location.'), 'error')
    }
  }, [confirm, t, reload])

  const columns = React.useMemo<ColumnDef<LocationRow>[]>(
    () => [
      {
        accessorKey: 'code',
        header: t('wms.locations.list.columns.code', 'Code'),
        meta: { priority: 1 },
      },
      {
        accessorKey: 'type',
        header: t('wms.locations.list.columns.type', 'Type'),
        cell: ({ row }) => (
          <span className="capitalize">{row.original.type}</span>
        ),
        meta: { priority: 2 },
      },
      {
        accessorKey: 'isActive',
        header: t('wms.locations.list.columns.isActive', 'Active'),
        cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
        meta: { priority: 3 },
      },
      {
        accessorKey: 'capacityUnits',
        header: t('wms.locations.list.columns.capacityUnits', 'Capacity (units)'),
        cell: ({ row }) => row.original.capacityUnits ?? '—',
        meta: { priority: 4 },
      },
      {
        accessorKey: 'capacityWeight',
        header: t('wms.locations.list.columns.capacityWeight', 'Capacity (weight)'),
        cell: ({ row }) => row.original.capacityWeight ?? '—',
        meta: { priority: 5 },
      },
    ],
    [t]
  )

  const rowActions = React.useCallback(
    (row: LocationRow) => [
      {
        label: t('common.edit', 'Edit'),
        onClick: () => router.push(`/backend/wms/locations/${row.id}`),
      },
      {
        label: t('common.delete', 'Delete'),
        onClick: () => handleDelete(row),
        variant: 'destructive' as const,
      },
    ],
    [t, router, handleDelete]
  )

  const filters = React.useMemo(() => (
    <select
      className="rounded border px-3 py-1.5 text-sm"
      value={filterType}
      onChange={(e) => { setFilterType(e.target.value); setPage(1) }}
    >
      <option value="">{t('wms.locations.list.filter.allTypes', 'All types')}</option>
      {LOCATION_TYPES.map((lt) => (
        <option key={lt} value={lt}>{lt}</option>
      ))}
    </select>
  ), [filterType, t])

  return (
    <Page>
      <PageHeader title={t('wms.locations.list.title', 'Warehouse Locations')} />
      <PageBody>
        <div className="mb-4 flex gap-2">{filters}</div>
        <DataTable<LocationRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder={t('wms.locations.list.search', 'Search locations…')}
          searchValue={search}
          onSearchChange={setSearch}
          onRowClick={(row) => router.push(`/backend/wms/locations/${row.id}`)}
          rowActions={rowActions}
          actions={(
            <Button asChild>
              <Link href="/backend/wms/locations/new">
                {t('wms.locations.list.actions.create', 'Create location')}
              </Link>
            </Button>
          )}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
