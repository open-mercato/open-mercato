"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

type RoleSummary = { id: string; name: string | null }

type Row = {
  id: string
  name: string
  description: string | null
  keyPrefix: string
  organizationId: string | null
  organizationName: string | null
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string | null
  roles: RoleSummary[]
}

type ResponsePayload = {
  items: Row[]
  total: number
  page: number
  totalPages: number
}

function formatDate(value: string | null, t: (key: string, params?: Record<string, string | number>) => string) {
  if (!value) return t('api_keys.list.noDate')
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return t('api_keys.list.noDate')
    return date.toLocaleString()
  } catch {
    return t('api_keys.list.noDate')
  }
}

export default function ApiKeysListPage() {
  const [rows, setRows] = React.useState<Row[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '20')
        if (search) params.set('search', search)
        const res = await apiFetch(`/api/api_keys/keys?${params.toString()}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          const message = typeof data?.error === 'string' ? data.error : t('api_keys.list.error.loadFailed')
          flash(message, 'error')
          return
        }
        const payload: ResponsePayload = await res.json()
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : t('api_keys.list.error.loadFailed')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, search, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(async (row: Row) => {
    if (!window.confirm(t('api_keys.list.confirmDelete', { name: row.name }))) return
    try {
      const res = await apiFetch(`/api/api_keys/keys?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const message = typeof data?.error === 'string' ? data.error : t('api_keys.list.error.deleteFailed')
        flash(message, 'error')
        return
      }
      flash(t('api_keys.list.success.deleted'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('api_keys.list.error.deleteFailed')
      flash(message, 'error')
    }
  }, [t])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    { accessorKey: 'name', header: t('api_keys.list.columns.name') },
    {
      accessorKey: 'keyPrefix',
      header: t('api_keys.list.columns.key'),
      cell: ({ row }) => <code className="text-xs">{row.original.keyPrefix}…</code>,
    },
    {
      accessorKey: 'organizationName',
      header: t('api_keys.list.columns.organization'),
      cell: ({ row }) => row.original.organizationName || t('api_keys.list.noDate'),
    },
    {
      accessorKey: 'roles',
      header: t('api_keys.list.columns.roles'),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.roles.length === 0 && <span className="text-muted-foreground text-xs">{t('api_keys.list.noRoles')}</span>}
          {row.original.roles.map((role) => (
            <span
              key={role.id}
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
            >
              {role.name || role.id}
            </span>
          ))}
        </div>
      ),
    },
    {
      accessorKey: 'lastUsedAt',
      header: t('api_keys.list.columns.lastUsed'),
      cell: ({ row }) => formatDate(row.original.lastUsedAt, t),
    },
    {
      accessorKey: 'expiresAt',
      header: t('api_keys.list.columns.expires'),
      cell: ({ row }) => formatDate(row.original.expiresAt, t),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('api_keys.list.title')}
          actions={(
            <Button asChild>
              <Link href="/backend/api-keys/create">{t('api_keys.list.actions.create')}</Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          perspective={{ tableId: 'api_keys.list' }}
          rowActions={(row) => (
            <RowActions items={[
              { label: t('common.delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
            ]} />
          )}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
