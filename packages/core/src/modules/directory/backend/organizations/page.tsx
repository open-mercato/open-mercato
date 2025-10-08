"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { BooleanIcon } from '@open-mercato/ui/backend/ValueIcons'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type OrganizationRow = {
  id: string
  name: string
  tenantId: string
  parentId: string | null
  parentName: string | null
  depth: number
  rootId: string
  treePath: string
  pathLabel: string
  ancestorIds: string[]
  childIds: string[]
  descendantIds: string[]
  childrenCount: number
  descendantsCount: number
  isActive: boolean
}

type OrganizationsResponse = {
  items: OrganizationRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const columns: ColumnDef<OrganizationRow>[] = [
  {
    accessorKey: 'name',
    header: 'Organization',
    cell: ({ row }) => {
      const depth = row.original.depth ?? 0
      return (
        <div className="flex items-center">
          <span style={{ marginLeft: depth * 16 }} className="font-medium text-sm leading-none">
            {row.original.name}
          </span>
        </div>
      )
    },
    meta: { priority: 1 },
  },
  {
    accessorKey: 'pathLabel',
    header: 'Path',
    meta: { priority: 3 },
    cell: ({ getValue }) => {
      const value = getValue<string>()
      return <span className="text-xs text-muted-foreground">{value}</span>
    },
  },
  {
    accessorKey: 'parentName',
    header: 'Parent',
    meta: { priority: 4 },
    cell: ({ getValue }) => getValue<string>() || '—',
  },
  {
    accessorKey: 'childrenCount',
    header: 'Children',
    meta: { priority: 5 },
  },
  {
    accessorKey: 'isActive',
    header: 'Active',
    enableSorting: false,
    meta: { priority: 2 },
    cell: ({ getValue }) => <BooleanIcon value={Boolean(getValue())} />,
  },
]

export default function DirectoryOrganizationsPage() {
  const queryClient = useQueryClient()
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [page, setPage] = React.useState(1)
  const [status, setStatus] = React.useState<string>('all')
  const [search, setSearch] = React.useState('')
  const [canManage, setCanManage] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await apiFetch('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['directory.organizations.manage'] }),
        })
        const json = await res.json().catch(() => ({}))
        if (!cancelled) {
          const granted = Array.isArray(json?.granted) ? json.granted : []
          setCanManage(json?.ok === true || granted.includes('directory.organizations.manage'))
        }
      } catch {
        if (!cancelled) setCanManage(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const queryParams = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('view', 'manage')
    params.set('page', String(page))
    params.set('pageSize', '50')
    params.set('sortField', sorting[0]?.id || 'name')
    params.set('sortDir', sorting[0]?.desc ? 'desc' : 'asc')
    params.set('status', status)
    if (status !== 'active') params.set('includeInactive', 'true')
    if (search) params.set('search', search)
    return params.toString()
  }, [page, sorting, status, search])

  const { data, isLoading } = useQuery<OrganizationsResponse>({
    queryKey: ['directory-organizations', queryParams],
    queryFn: async () => {
      const res = await apiFetch(`/api/directory/organizations?${queryParams}`)
      if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to load organizations'))
      return res.json()
    },
  })

  const rows = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = data?.totalPages ?? 1

  const handleDelete = React.useCallback(async (org: OrganizationRow) => {
    if (!window.confirm(`Archive organization "${org.name}"?`)) return
    try {
      const res = await apiFetch(`/api/directory/organizations?id=${encodeURIComponent(org.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(await res.text().catch(() => 'Failed to delete organization'))
      await queryClient.invalidateQueries({ queryKey: ['directory-organizations'] })
      flash.success('Organization deleted')
    } catch (err: any) {
      flash.error(err?.message || 'Failed to delete organization')
    }
  }, [queryClient])

  return (
    <Page>
      <PageBody>
        <DataTable
          title="Organizations"
          actions={canManage ? (
            <Button asChild>
              <Link href="/backend/directory/organizations/create">Create</Link>
            </Button>
          ) : undefined}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          filters={[
            {
              id: 'status',
              label: 'Status',
              type: 'select',
              options: [
                { value: 'all', label: 'All' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ],
            },
          ]}
          filterValues={{ status }}
          onFiltersApply={(vals: FilterValues) => {
            const nextStatus = (vals.status as string) || 'all'
            setStatus(nextStatus)
            setPage(1)
          }}
          onFiltersClear={() => {
            setStatus('all')
            setPage(1)
          }}
          sortable
          sorting={sorting}
          onSortingChange={(next) => { setSorting(next); setPage(1) }}
          rowActions={(row) => (
            canManage ? (
              <RowActions
                items={[
                  { label: 'Edit', href: `/backend/directory/organizations/${row.id}/edit` },
                  { label: 'Delete', destructive: true, onSelect: () => handleDelete(row) },
                ]}
              />
            ) : null
          )}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}

