"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/backend/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

type Row = { id: string; email: string; organizationId: string | null; roles: string[] }

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'email', header: 'Email' },
  { accessorKey: 'organizationId', header: 'Organization' },
  { accessorKey: 'roles', header: 'Roles', cell: ({ row }) => (row.original.roles || []).join(', ') },
]

export default function UsersListPage() {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'email', desc: false }])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [values, setValues] = React.useState<Record<string, any>>({})
  const [rows, setRows] = React.useState<Row[]>([])
  const [isLoading, setIsLoading] = React.useState(true)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        if (search) params.set('search', search)
        if (values.organizationId) params.set('organizationId', String(values.organizationId))
        const res = await apiFetch(`/api/auth/users?${params.toString()}`)
        const j = await res.json()
        if (!cancelled) {
          setRows(j.items || [])
          setTotal(j.total || 0)
          setTotalPages(j.totalPages || 1)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, search, values])

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
          data={rows}
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


