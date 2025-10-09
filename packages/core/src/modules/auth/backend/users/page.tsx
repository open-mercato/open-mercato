"use client"
import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { OrganizationSelect } from '@open-mercato/core/modules/directory/components/OrganizationSelect'

type Row = { id: string; email: string; organizationId: string | null; organizationName?: string; roles: string[] }

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'organizationName', header: 'Organization' },
  { accessorKey: 'roles', header: 'Roles', cell: ({ row }) => (row.original.roles || []).join(', ') },
]

type UsersToolbarProps = {
  organizationId: string | null
  onOrganizationChange: (value: string | null) => void
  onOrganizationClear: () => void
  searchValue: string
  onSearchChange: (value: string) => void
}

function UsersToolbar({ organizationId, onOrganizationChange, onOrganizationClear, searchValue, onSearchChange }: UsersToolbarProps) {
  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex flex-wrap items-center gap-2 w-full">
        <div className="inline-flex items-center gap-2">
          <OrganizationSelect
            id="users-filter-organization"
            value={organizationId}
            onChange={onOrganizationChange}
            includeAllOption
            allOptionLabel="All organizations"
            required={false}
            className="h-9 min-w-[220px] rounded border px-2 text-sm"
          />
          {organizationId ? (
            <Button variant="outline" size="sm" onClick={onOrganizationClear}>
              Clear
            </Button>
          ) : null}
        </div>
        <div className="relative w-full sm:w-[240px] ml-auto">
          <input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search"
            className="h-9 w-full rounded border pl-8 pr-2 text-sm"
            suppressHydrationWarning
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">🔍</span>
        </div>
      </div>
    </div>
  )
}

export default function UsersListPage() {
  const searchParams = useSearchParams()
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'email', desc: false }])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<Record<string, any>>({})
  const queryClient = useQueryClient()
  const roleId = searchParams?.get('roleId') ?? null

  // Fetch users
  const params = React.useMemo(() => {
    const p = new URLSearchParams()
    p.set('page', String(page))
    p.set('pageSize', '50')
    if (search) p.set('search', search)
    if (values.organizationId) p.set('organizationId', String(values.organizationId))
    if (roleId) p.set('roleId', roleId)
    return p.toString()
  }, [page, search, values, roleId])

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['users', params],
    queryFn: async () => {
      const res = await apiFetch(`/api/auth/users?${params}`)
      return res.json() as Promise<{ items: Row[]; total: number; totalPages: number }>
    },
  })

  const rows = usersData?.items || []
  const total = usersData?.total || 0
  const totalPages = usersData?.totalPages || 1
  const rowsWithOrgNames: Row[] = React.useMemo(() => rows.map(row => ({
    ...row,
    organizationName: row.organizationName ?? (row.organizationId ?? undefined),
  })), [rows])
  const organizationId = values.organizationId ? String(values.organizationId) : null

  const handleOrganizationChange = React.useCallback((next: string | null) => {
    if ((next ?? null) === organizationId) return
    setValues((prev) => {
      const updated = { ...prev }
      if (!next) {
        delete updated.organizationId
      } else {
        updated.organizationId = next
      }
      return updated
    })
    setPage(1)
  }, [organizationId, setPage, setValues])

  const handleOrganizationClear = React.useCallback(() => {
    if (!organizationId) return
    setValues((prev) => {
      const updated = { ...prev }
      delete updated.organizationId
      return updated
    })
    setPage(1)
  }, [organizationId, setPage, setValues])

  const handleSearchChange = React.useCallback((value: string) => {
    setSearch(value)
    setPage(1)
  }, [setPage, setSearch])

  const handleDelete = React.useCallback(async (row: Row) => {
    if (!window.confirm(`Delete user "${row.email}"?`)) return
    try {
      const res = await apiFetch(`/api/auth/users?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        let message = 'Failed to delete user'
        try {
          const data = await res.json()
          if (data?.error && typeof data.error === 'string') message = data.error
        } catch {}
        throw new Error(message)
      }
      flash('User deleted', 'success')
      await queryClient.invalidateQueries({ queryKey: ['users'] })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete user'
      flash(message, 'error')
    }
  }, [queryClient])

  return (
    <Page>
      <PageBody>
        <DataTable
          title="Users"
          actions={(
            <Button asChild>
              <Link href="/backend/users/create">Create</Link>
            </Button>
          )}
          columns={columns}
          data={rowsWithOrgNames}
          toolbar={(
            <UsersToolbar
              organizationId={organizationId}
              onOrganizationChange={handleOrganizationChange}
              onOrganizationClear={handleOrganizationClear}
              searchValue={search}
              onSearchChange={handleSearchChange}
            />
          )}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          rowActions={(row) => (
            <RowActions items={[
              { label: 'Edit', href: `/backend/users/${row.id}/edit` },
              { label: 'Show roles', href: `/backend/roles?userId=${encodeURIComponent(row.id)}` },
              { label: 'Delete', destructive: true, onSelect: () => { void handleDelete(row) } },
            ]} />
          )}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
