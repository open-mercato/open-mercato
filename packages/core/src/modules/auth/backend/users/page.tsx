"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useQuery } from '@tanstack/react-query'

type Row = { id: string; email: string; organizationId: string | null; organizationName?: string; roles: string[] }

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'organizationName', header: 'Organization' },
  { accessorKey: 'roles', header: 'Roles', cell: ({ row }) => (row.original.roles || []).join(', ') },
]

export default function UsersListPage() {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'email', desc: false }])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<Record<string, any>>({})

  // Fetch users
  const params = React.useMemo(() => {
    const p = new URLSearchParams()
    p.set('page', String(page))
    p.set('pageSize', '50')
    if (search) p.set('search', search)
    if (values.organizationId) p.set('organizationId', String(values.organizationId))
    return p.toString()
  }, [page, search, values])

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
          searchValue={search}
          onSearchChange={(v) => { setSearch(v); setPage(1) }}
          filters={[{ id: 'organizationId', label: 'Organization', type: 'text' }]}
          filterValues={values}
          onFiltersApply={(vals) => { setValues(vals); setPage(1) }}
          onFiltersClear={() => { setValues({}); setPage(1) }}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          rowActions={(row) => (
            <RowActions items={[
              { label: 'Edit', href: `/backend/users/${row.id}/edit` },
              { label: 'Show roles', href: `/backend/roles?userId=${encodeURIComponent(row.id)}` },
            ]} />
          )}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}

