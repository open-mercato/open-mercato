"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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
  const t = useT()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        if (search) params.set('search', search)
        const fallback = { items: [], total: 0, totalPages: 1, isSuperAdmin: false }
        const j = await readApiResultOrThrow<{
          items?: Row[]
          total?: number
          totalPages?: number
          isSuperAdmin?: boolean
        }>(
          `/api/auth/roles?${params.toString()}`,
          undefined,
          { errorMessage: t('auth.roles.list.error.load', 'Failed to load roles'), fallback },
        )
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
  }, [page, search, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(async (row: Row) => {
    if (!window.confirm(t('auth.roles.list.confirmDelete', 'Delete role "{{name}}"?').replace('{{name}}', row.name))) return
    try {
      const call = await apiCall(
        `/api/auth/roles?id=${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
      )
      if (!call.ok) {
        await raiseCrudError(call.response, t('auth.roles.list.error.delete', 'Failed to delete role'))
      }
      flash(t('auth.roles.list.success.delete', 'Role deleted'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('auth.roles.list.error.delete', 'Failed to delete role')
      flash(message, 'error')
    }
  }, [t])

  const showTenantColumn = React.useMemo(
    () => isSuperAdmin && rows.some((row) => row.tenantName),
    [isSuperAdmin, rows],
  )
  const columns = React.useMemo<ColumnDef<Row>[]>(() => {
    const base: ColumnDef<Row>[] = [
      { accessorKey: 'name', header: t('auth.roles.list.columns.role', 'Role') },
      { accessorKey: 'usersCount', header: t('auth.roles.list.columns.users', 'Users') },
    ]
    if (showTenantColumn) {
      base.splice(1, 0, { accessorKey: 'tenantName', header: t('auth.roles.list.columns.tenant', 'Tenant') })
    }
    return base
  }, [showTenantColumn, t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('auth.roles.list.title', 'Roles')}
          actions={(
            <Button asChild>
              <Link href="/backend/roles/create">{t('auth.roles.list.actions.create', 'Create')}</Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(v) => { setSearch(v); setPage(1) }}
          rowActions={(row) => (
            <RowActions items={[
              { label: t('common.edit', 'Edit'), href: `/backend/roles/${row.id}/edit` },
              { label: t('auth.roles.list.actions.showUsers', 'Show users'), href: `/backend/users?roleId=${encodeURIComponent(row.id)}` },
              { label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
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
