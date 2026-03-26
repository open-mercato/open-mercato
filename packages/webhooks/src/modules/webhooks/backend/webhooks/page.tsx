"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { useWebhookFeatureAccess } from './useWebhookFeatureAccess'

type Row = {
  id: string
  name: string
  description: string | null
  url: string
  subscribedEvents: string[]
  httpMethod: string
  isActive: boolean
  deliveryStrategy: string
  maxRetries: number
  consecutiveFailures: number
  lastSuccessAt: string | null
  lastFailureAt: string | null
  createdAt: string
  updatedAt: string
}

type ResponsePayload = {
  items: Row[]
  total: number
  page: number
  totalPages: number
}

export default function WebhooksListPage() {
  const [rows, setRows] = React.useState<Row[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const access = useWebhookFeatureAccess()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '20')
        if (search) params.set('search', search)
        if (typeof filterValues.status === 'string' && filterValues.status.length > 0) {
          params.set('isActive', filterValues.status)
        }
        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(
          `/api/webhooks?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          const errorPayload = call.result as { error?: string } | undefined
          const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('webhooks.list.loadError')
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
          const message = error instanceof Error ? error.message : t('webhooks.list.loadError')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [filterValues.status, page, search, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(async (row: Row) => {
    const confirmed = await confirm({
      title: t('webhooks.list.confirmDelete'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      const call = await apiCall<{ error?: string }>(
        `/api/webhooks/${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
        { fallback: null },
      )
      if (!call.ok) {
        const errorPayload = call.result as { error?: string } | undefined
        const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('webhooks.list.deleteError')
        flash(message, 'error')
        return
      }
      flash(t('webhooks.list.deleteSuccess'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('webhooks.list.deleteError')
      flash(message, 'error')
    }
  }, [confirm, t])

  const handleToggleActive = React.useCallback(async (row: Row) => {
    try {
      const call = await apiCall<Row>(
        `/api/webhooks/${encodeURIComponent(row.id)}`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ isActive: !row.isActive }),
        },
        { fallback: null },
      )
      if (!call.ok) {
        flash(t('webhooks.form.updateError'), 'error')
        return
      }
      flash(t('webhooks.form.updateSuccess'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      flash(error instanceof Error ? error.message : t('webhooks.form.updateError'), 'error')
    }
  }, [t])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('webhooks.list.filters.status'),
      type: 'select',
      options: [
        { value: 'true', label: t('webhooks.list.status.active') },
        { value: 'false', label: t('webhooks.list.status.inactive') },
      ],
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    {
      accessorKey: 'name',
      header: t('webhooks.list.columns.name'),
      cell: ({ row }) => (
        <Link href={`/backend/webhooks/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'url',
      header: t('webhooks.list.columns.url'),
      cell: ({ row }) => (
        <code className="text-xs truncate max-w-[200px] block" title={row.original.url}>{row.original.url}</code>
      ),
      meta: { truncate: true, maxWidth: 250 },
    },
    {
      accessorKey: 'subscribedEvents',
      header: t('webhooks.list.columns.events'),
      cell: ({ row }) => {
        const events = row.original.subscribedEvents
        if (events.length === 0) return <span className="text-muted-foreground text-xs">—</span>
        if (events.length <= 2) return <span className="text-xs">{events.join(', ')}</span>
        return <span className="text-xs">{events.slice(0, 2).join(', ')} +{events.length - 2}</span>
      },
    },
    {
      accessorKey: 'isActive',
      header: t('webhooks.list.columns.status'),
      cell: ({ row }) => (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${row.original.isActive ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}`}>
          {row.original.isActive ? t('webhooks.list.status.active') : t('webhooks.list.status.inactive')}
        </span>
      ),
    },
    {
      accessorKey: 'lastSuccessAt',
      header: t('webhooks.list.columns.lastDelivery'),
      cell: ({ row }) => {
        const lastSuccessAt = row.original.lastSuccessAt ? new Date(row.original.lastSuccessAt).getTime() : null
        const lastFailureAt = row.original.lastFailureAt ? new Date(row.original.lastFailureAt).getTime() : null
        const lastTimestamp = Math.max(lastSuccessAt ?? 0, lastFailureAt ?? 0)
        if (!lastTimestamp) return <span className="text-muted-foreground">—</span>
        const isFailure = lastFailureAt !== null && lastFailureAt >= (lastSuccessAt ?? 0)
        return (
          <span className={isFailure ? 'text-destructive' : 'text-muted-foreground'}>
            {new Date(lastTimestamp).toLocaleString()}
          </span>
        )
      },
    },
    {
      accessorKey: 'createdAt',
      header: t('webhooks.list.columns.createdAt'),
      cell: ({ row }) => {
        try {
          return new Date(row.original.createdAt).toLocaleDateString()
        } catch {
          return '—'
        }
      },
    },
  ], [t])

  return (
    <Page>
      <PageBody className="space-y-4">
        <Notice title={t('webhooks.list.description')} message={t('webhooks.list.operatorTip')} />
        <DataTable
          title={t('webhooks.list.title')}
          actions={access.canManage ? (
            <Button asChild>
              <Link href="/backend/webhooks/create">{t('webhooks.nav.create')}</Link>
            </Button>
          ) : undefined}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(next) => {
            setFilterValues(next)
            setPage(1)
          }}
          onFiltersClear={() => {
            setFilterValues({})
            setPage(1)
          }}
          perspective={{ tableId: 'webhooks.list' }}
          rowActions={(row) => {
            const items = [
              {
                id: 'view-deliveries',
                label: t('webhooks.list.actions.viewDeliveries'),
                onSelect: () => { router.push(`/backend/webhooks/${row.id}`) },
              },
            ]

            if (access.canManage) {
              items.unshift(
                { id: 'edit', label: t('webhooks.list.actions.edit'), onSelect: () => { router.push(`/backend/webhooks/${row.id}`) } },
                {
                  id: 'toggle-active',
                  label: row.isActive ? t('webhooks.detail.actions.deactivate') : t('webhooks.detail.actions.activate'),
                  onSelect: () => { void handleToggleActive(row) },
                },
              )
              items.push({ id: 'delete', label: t('webhooks.list.actions.delete'), onSelect: () => { void handleDelete(row) } })
            }

            return <RowActions items={items} />
          }}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
