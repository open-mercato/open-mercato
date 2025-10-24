"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'

type Row = {
  id: string
  name: string
  usersCount: number
  tenantId?: string | null
  tenantIds?: string[]
  tenantName?: string | null
}

export default function RolesListPage() {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'name', desc: false }])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [rows, setRows] = React.useState<Row[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [isSuperAdmin, setIsSuperAdmin] = React.useState(false)
  const scopeVersion = useOrganizationScopeVersion()

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
          setIsSuperAdmin(!!j.isSuperAdmin)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, search, reloadToken, scopeVersion])

  const handleDelete = React.useCallback(async (row: Row) => {
    if (!window.confirm(`Delete role "${row.name}"?`)) return
    try {
      const res = await apiFetch(`/api/auth/roles?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        let message = 'Failed to delete role'
        try {
          const data = await res.json()
          if (data?.error && typeof data.error === 'string') message = data.error
        } catch {}
        flash(message, 'error')
        return
      }
      flash('Role deleted', 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete role'
      flash(message, 'error')
    }
  }, [])

  const showTenantColumn = React.useMemo(
    () => isSuperAdmin && rows.some((row) => row.tenantName),
    [isSuperAdmin, rows],
  )
  const columns = React.useMemo<ColumnDef<Row>[]>(() => {
    const base: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: 'Role' },
      { accessorKey: 'usersCount', header: 'Users' },
    ]
    if (showTenantColumn) {
      base.splice(1, 0, { accessorKey: 'tenantName', header: 'Tenant' })
    }
    return base
  }, [showTenantColumn])

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
              { label: 'Delete', destructive: true, onSelect: () => { void handleDelete(row) } },
            ]} />
          )}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          perspective={{ tableId: 'auth.roles.list' }}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
