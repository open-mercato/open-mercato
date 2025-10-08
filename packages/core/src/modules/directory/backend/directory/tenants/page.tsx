"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type TenantRow = {
  id: string
  name: string
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
}

type TenantsResponse = {
  items: TenantRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const columns: ColumnDef<TenantRow>[] = [
  { accessorKey: 'name', header: 'Tenant', meta: { priority: 1 } },
  {
    accessorKey: 'isActive',
    header: 'Active',
    enableSorting: false,
    meta: { priority: 2 },
    cell: ({ getValue }) => <BooleanIcon value={Boolean(getValue())} />,
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    meta: { priority: 3 },
    cell: ({ getValue }) => {
      const timestamp = getValue() as string | null
      if (!timestamp) return <span className="text-xs text-muted-foreground">—</span>
      const date = new Date(timestamp)
      if (Number.isNaN(date.getTime())) return <span className="text-xs text-muted-foreground">—</span>
      return <span>{date.toLocaleString()}</span>
    },
  },
]

export default function DirectoryTenantsPage() {
  const queryClient = useQueryClient()
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [canManage, setCanManage] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function loadFeature() {
      try {
        const res = await apiFetch('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['directory.tenants.manage'] }),
        })
        const json = await res.json().catch(() => ({}))
        if (!cancelled) {
          const granted = Array.isArray(json?.granted) ? json.granted : []
          setCanManage(json?.ok === true || granted.includes('directory.tenants.manage'))
        }
      } catch {
        if (!cancelled) setCanManage(false)
      }
    }
    loadFeature()
    return () => { cancelled = true }
  }, [])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', '20')
    if (sorting.length > 0) {
      params.set('sortField', sorting[0]?.id || 'name')
      params.set('sortDir', sorting[0]?.desc ? 'desc' : 'asc')
    }
    if (search) params.set('search', search)
    if (filters.active !== undefined && filters.active !== '') params.set('isActive', String(filters.active))
    return params.toString()
  }, [page, sorting, search, filters])

  const { data, isLoading } = useQuery({
    queryKey: ['directory-tenants', queryParams],
    queryFn: async (): Promise<TenantsResponse> => {
      const res = await apiFetch(`/api/directory/tenants?${queryParams}`)
      if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to load tenants'))
      return res.json()
    },
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  const handleDelete = React.useCallback(async (tenant: TenantRow) => {
    if (!window.confirm(`Delete tenant "${tenant.name}"? This will archive it.`)) return
    try {
      const res = await apiFetch(`/api/directory/tenants?id=${encodeURIComponent(tenant.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to delete tenant'))
      await queryClient.invalidateQueries({ queryKey: ['directory-tenants'] })
      flash.success('Tenant deleted')
    } catch (err: any) {
      flash.error(err?.message || 'Failed to delete tenant')
    }
  }, [queryClient])

  return (
    <Page>
      <PageBody>
        <DataTable
          title="Tenants"
          actions={canManage ? (
            <Button asChild>
              <Link href="/backend/directory/tenants/create">Create</Link>
            </Button>
          ) : undefined}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          filters={[{ id: 'active', label: 'Status', type: 'select', options: [
            { value: 'true', label: 'Active' },
            { value: 'false', label: 'Inactive' },
          ] }]}
          filterValues={filters}
          onFiltersApply={(vals) => { setFilters(vals); setPage(1) }}
          onFiltersClear={() => { setFilters({}); setPage(1) }}
          sortable
          sorting={sorting}
          onSortingChange={(state) => { setSorting(state); setPage(1) }}
          rowActions={(row) => (
            canManage ? (
              <RowActions
                items={[
                  { label: 'Edit', href: `/backend/directory/tenants/${row.id}/edit` },
                  { label: 'Delete', destructive: true, onSelect: () => handleDelete(row) },
                ]}
              />
            ) : null
          )}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
