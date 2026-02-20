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

type WarehouseRow = {
  id: string
  name: string
  code: string
  isActive: boolean
  timezone?: string | null
}

type WarehousesResponse = {
  items: Array<Record<string, unknown>>
  total: number
  page: number
  totalPages: number
}

function mapApiRow(raw: Record<string, unknown>): WarehouseRow {
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    name: typeof raw.name === 'string' ? raw.name : '',
    code: typeof raw.code === 'string' ? raw.code : '',
    isActive: raw.isActive === true,
    timezone: typeof raw.timezone === 'string' ? raw.timezone : null,
  }
}

export default function WmsWarehousesPage() {
  const [rows, setRows] = React.useState<WarehouseRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
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
        const fallback: WarehousesResponse = { items: [], total: 0, page: 1, totalPages: 1 }
        const call = await apiCall<WarehousesResponse>(
          `/api/wms/warehouses?${params.toString()}`,
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
          flash(t('wms.warehouses.list.error.load', 'Failed to load warehouses.'), 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, search, scopeVersion, reloadKey, t])

  const handleDelete = React.useCallback(async (row: WarehouseRow) => {
    const confirmed = await confirm({
      title: t('wms.warehouses.delete.confirm', 'Are you sure you want to delete warehouse "{name}"?', { name: row.name }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await deleteCrud('wms/warehouses', row.id)
      flash(t('wms.warehouses.delete.success', 'Warehouse deleted.'), 'success')
      reload()
    } catch {
      flash(t('wms.warehouses.delete.error', 'Failed to delete warehouse.'), 'error')
    }
  }, [confirm, t, reload])

  const columns = React.useMemo<ColumnDef<WarehouseRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('wms.warehouses.list.columns.name', 'Name'),
        meta: { priority: 1 },
      },
      {
        accessorKey: 'code',
        header: t('wms.warehouses.list.columns.code', 'Code'),
        meta: { priority: 2 },
      },
      {
        accessorKey: 'isActive',
        header: t('wms.warehouses.list.columns.isActive', 'Active'),
        cell: ({ row }) => <BooleanIcon value={row.original.isActive} />,
        meta: { priority: 3 },
      },
      {
        accessorKey: 'timezone',
        header: t('wms.warehouses.list.columns.timezone', 'Timezone'),
        meta: { priority: 4 },
      },
    ],
    [t]
  )

  const rowActions = React.useCallback(
    (row: WarehouseRow) => [
      {
        label: t('common.edit', 'Edit'),
        onClick: () => router.push(`/backend/wms/warehouses/${row.id}`),
      },
      {
        label: t('common.delete', 'Delete'),
        onClick: () => handleDelete(row),
        variant: 'destructive' as const,
      },
    ],
    [t, router, handleDelete]
  )

  return (
    <Page>
      <PageHeader title={t('wms.warehouses.list.title', 'Warehouses')} />
      <PageBody>
        <DataTable<WarehouseRow>
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchPlaceholder={t('wms.warehouses.list.search', 'Search warehouses…')}
          searchValue={search}
          onSearchChange={setSearch}
          onRowClick={(row) => router.push(`/backend/wms/warehouses/${row.id}`)}
          rowActions={rowActions}
          actions={(
            <Button asChild>
              <Link href="/backend/wms/warehouses/new">
                {t('wms.warehouses.list.actions.create', 'Create warehouse')}
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
