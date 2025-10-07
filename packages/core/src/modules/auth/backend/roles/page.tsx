"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

type Row = { id: string; name: string; usersCount: number }

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Role' },
  { accessorKey: 'usersCount', header: 'Users' },
]

export default function RolesListPage() {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
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
        const res = await apiFetch(`/api/auth/roles?${params.toString()}`)
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
  }, [page, search])

  return (
    <Page>
      <PageBody>
        <DataTable
          title="Roles"
          actions={(
            <Button asChild>
              <Link href="/backend/roles/create">Create</Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(v) => { setSearch(v); setPage(1) }}
          rowActions={(row) => (
            <RowActions items={[
              { label: 'Edit', href: `/backend/roles/${row.id}/edit` },
              { label: 'Show users', href: `/backend/users?roleId=${encodeURIComponent(row.id)}` },
            ]} />
          )}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}


