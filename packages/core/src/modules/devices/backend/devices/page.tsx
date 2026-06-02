"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

type Row = {
  id: string
  user_id: string
  device_id: string
  platform: string
  client_app_version: string | null
  os_version: string | null
  push_provider: string | null
  push_token_updated_at: string | null
  last_seen_at: string | null
  created_at: string | null
}

type ResponsePayload = {
  items: Row[]
  total: number
  page?: number
  pageSize?: number
  totalPages: number
}

function formatDate(value: string | null, t: (key: string) => string) {
  if (!value) return t('devices.list.noValue')
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return t('devices.list.noValue')
    return date.toLocaleString()
  } catch {
    return t('devices.list.noValue')
  }
}

export default function DevicesAdminListPage() {
  const [rows, setRows] = React.useState<Row[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(`/api/devices/admin/devices?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          const errorPayload = call.result as { error?: string } | undefined
          const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('devices.list.error.loadFailed')
          flash(message, 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : t('devices.list.error.loadFailed')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, reloadToken, scopeVersion, t])

  const handleDeactivate = React.useCallback(async (row: Row) => {
    const confirmed = await confirm({
      title: t('devices.list.confirmDeactivate'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const call = await apiCall<{ error?: string }>(
        `/api/devices/admin/devices/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
        { fallback: null },
      )
      if (!call.ok) {
        const errorPayload = call.result as { error?: string } | undefined
        const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('devices.list.error.deactivateFailed')
        flash(message, 'error')
        return
      }
      flash(t('devices.list.success.deactivated'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('devices.list.error.deactivateFailed')
      flash(message, 'error')
    }
  }, [confirm, t])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    {
      accessorKey: 'device_id',
      header: t('devices.list.columns.device'),
      cell: ({ row }) => <code className="text-xs">{row.original.device_id}</code>,
    },
    { accessorKey: 'platform', header: t('devices.list.columns.platform') },
    {
      accessorKey: 'user_id',
      header: t('devices.list.columns.user'),
      cell: ({ row }) => <code className="text-xs">{row.original.user_id}</code>,
    },
    {
      accessorKey: 'client_app_version',
      header: t('devices.list.columns.appVersion'),
      cell: ({ row }) => row.original.client_app_version || t('devices.list.noValue'),
    },
    {
      accessorKey: 'os_version',
      header: t('devices.list.columns.osVersion'),
      cell: ({ row }) => row.original.os_version || t('devices.list.noValue'),
    },
    {
      accessorKey: 'push_provider',
      header: t('devices.list.columns.pushProvider'),
      cell: ({ row }) => row.original.push_provider || t('devices.list.noValue'),
    },
    {
      accessorKey: 'last_seen_at',
      header: t('devices.list.columns.lastSeen'),
      cell: ({ row }) => formatDate(row.original.last_seen_at, t),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('devices.list.title')}
          actions={(
            <Button asChild>
              <Link href="/backend/devices/create">{t('devices.list.actions.register')}</Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          perspective={{ tableId: 'devices.list' }}
          rowActions={(row) => (
            <RowActions items={[
              { id: 'edit', label: t('devices.list.actions.edit'), href: `/backend/devices/${row.id}` },
              { id: 'deactivate', label: t('devices.list.actions.deactivate'), destructive: true, onSelect: () => { void handleDeactivate(row) } },
            ]} />
          )}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
