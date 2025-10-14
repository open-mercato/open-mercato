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

function formatDate(value: string | null) {
  if (!value) return '—'
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleString()
  } catch {
    return '—'
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
          const message = typeof data?.error === 'string' ? data.error : 'Failed to load API keys'
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
          const message = error instanceof Error ? error.message : 'Failed to load API keys'
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, search, reloadToken, scopeVersion])

  const handleDelete = React.useCallback(async (row: Row) => {
    if (!window.confirm(`Delete API key "${row.name}"? This invalidates the secret immediately.`)) return
    try {
      const res = await apiFetch(`/api/api_keys/keys?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        const message = typeof data?.error === 'string' ? data.error : 'Failed to delete API key'
        flash(message, 'error')
        return
      }
      flash('API key deleted', 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete API key'
      flash(message, 'error')
    }
  }, [])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    { accessorKey: 'name', header: 'Name' },
    {
      accessorKey: 'keyPrefix',
      header: 'Key',
      cell: ({ row }) => <code className="text-xs">{row.original.keyPrefix}…</code>,
    },
    {
      accessorKey: 'organizationName',
      header: 'Organization',
      cell: ({ row }) => row.original.organizationName || '—',
    },
    {
      accessorKey: 'roles',
      header: 'Roles',
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.roles.length === 0 && <span className="text-muted-foreground text-xs">None</span>}
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
      header: 'Last Used',
      cell: ({ row }) => formatDate(row.original.lastUsedAt),
    },
    {
      accessorKey: 'expiresAt',
      header: 'Expires',
      cell: ({ row }) => formatDate(row.original.expiresAt),
    },
  ], [])

  return (
    <Page>
      <PageBody>
        <DataTable
          title="API Keys"
          actions={(
            <Button asChild>
              <Link href="/backend/api-keys/create">Create</Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          rowActions={(row) => (
            <RowActions items={[
              { label: 'Delete', destructive: true, onSelect: () => { void handleDelete(row) } },
            ]} />
          )}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
