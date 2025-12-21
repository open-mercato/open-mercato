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
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

type WebhookRow = {
  id: string
  name: string
  description: string | null
  deliveryType: 'http' | 'sqs' | 'sns'
  events: string[]
  active: boolean
  timeout: number
  createdAt: string
  updatedAt: string
  lastTriggeredAt: string | null
}

type ResponsePayload = {
  items: WebhookRow[]
  total: number
  page: number
  totalPages: number
}

const deliveryTypeBadgeStyles: Record<string, string> = {
  http: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200 dark:border-blue-800',
  sqs: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  sns: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200 dark:border-purple-800',
}

const deliveryTypeLabels: Record<string, string> = {
  http: 'HTTP',
  sqs: 'SQS',
  sns: 'SNS',
}

function DeliveryTypeBadge({ type }: { type: string }) {
  const styles = deliveryTypeBadgeStyles[type] || 'bg-gray-100 text-gray-800 border-gray-200'
  const label = deliveryTypeLabels[type] || type.toUpperCase()
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${styles}`}>
      {label}
    </span>
  )
}

function ActiveStatusBadge({ active }: { active: boolean }) {
  if (active) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        <span className="text-emerald-700 dark:text-emerald-400 font-medium">Active</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />
      <span className="text-muted-foreground">Inactive</span>
    </span>
  )
}

function formatDate(value: string | null, t: (key: string) => string) {
  if (!value) return <span className="text-muted-foreground text-xs">—</span>
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return <span className="text-muted-foreground text-xs">—</span>
    return (
      <span className="text-sm tabular-nums">
        {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        <span className="text-muted-foreground ml-1">
          {date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>
      </span>
    )
  } catch {
    return <span className="text-muted-foreground text-xs">—</span>
  }
}

function EventsCount({ events }: { events: string[] }) {
  const count = events.length
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded-full bg-slate-100 dark:bg-slate-800 px-2 text-xs font-medium tabular-nums">
        {count}
      </span>
      <span className="text-muted-foreground text-xs truncate max-w-[120px]" title={events.join(', ')}>
        {events.slice(0, 2).join(', ')}
        {events.length > 2 && '...'}
      </span>
    </div>
  )
}

export default function WebhooksListPage() {
  const [rows, setRows] = React.useState<WebhookRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [deliveryTypeFilter, setDeliveryTypeFilter] = React.useState<string>('')
  const [activeFilter, setActiveFilter] = React.useState<string>('')
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
        if (deliveryTypeFilter) params.set('deliveryType', deliveryTypeFilter)
        if (activeFilter) params.set('active', activeFilter)

        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(
          `/api/webhooks?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          const errorPayload = call.result as { error?: string } | undefined
          const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('webhooks.list.error.loadFailed')
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
          const message = error instanceof Error ? error.message : t('webhooks.list.error.loadFailed')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, search, deliveryTypeFilter, activeFilter, reloadToken, scopeVersion, t])

  const handleDelete = React.useCallback(async (row: WebhookRow) => {
    if (!window.confirm(t('webhooks.list.confirmDelete').replace('{name}', row.name))) return
    try {
      const call = await apiCall<{ error?: string }>(
        `/api/webhooks?id=${encodeURIComponent(row.id)}`,
        { method: 'DELETE' },
        { fallback: null },
      )
      if (!call.ok) {
        const errorPayload = call.result as { error?: string } | undefined
        const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('webhooks.list.error.deleteFailed')
        flash(message, 'error')
        return
      }
      flash(t('webhooks.list.success.deleted'), 'success')
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('webhooks.list.error.deleteFailed')
      flash(message, 'error')
    }
  }, [t])

  const columns = React.useMemo<ColumnDef<WebhookRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('webhooks.list.columns.name'),
      cell: ({ row }) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{row.original.name}</span>
          {row.original.description && (
            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
              {row.original.description}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'deliveryType',
      header: t('webhooks.list.columns.deliveryType'),
      cell: ({ row }) => <DeliveryTypeBadge type={row.original.deliveryType} />,
    },
    {
      accessorKey: 'events',
      header: t('webhooks.list.columns.events'),
      cell: ({ row }) => <EventsCount events={row.original.events} />,
    },
    {
      accessorKey: 'active',
      header: t('webhooks.list.columns.status'),
      cell: ({ row }) => <ActiveStatusBadge active={row.original.active} />,
    },
    {
      accessorKey: 'lastTriggeredAt',
      header: t('webhooks.list.columns.lastTriggered'),
      cell: ({ row }) => formatDate(row.original.lastTriggeredAt, t),
    },
  ], [t])

  const filters = React.useMemo(() => [
    {
      id: 'deliveryType',
      label: t('webhooks.list.filters.deliveryType'),
      value: deliveryTypeFilter,
      onChange: (value: string) => { setDeliveryTypeFilter(value); setPage(1) },
      options: [
        { value: '', label: t('webhooks.list.filters.allTypes') },
        { value: 'http', label: 'HTTP' },
        { value: 'sqs', label: 'AWS SQS' },
        { value: 'sns', label: 'AWS SNS' },
      ],
    },
    {
      id: 'active',
      label: t('webhooks.list.filters.status'),
      value: activeFilter,
      onChange: (value: string) => { setActiveFilter(value); setPage(1) },
      options: [
        { value: '', label: t('webhooks.list.filters.allStatuses') },
        { value: 'true', label: t('webhooks.list.filters.active') },
        { value: 'false', label: t('webhooks.list.filters.inactive') },
      ],
    },
  ], [deliveryTypeFilter, activeFilter, t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('webhooks.list.title')}
          actions={(
            <Button asChild>
              <Link href="/backend/webhooks/create">
                <svg
                  className="mr-2 h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
                {t('webhooks.list.actions.create')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('webhooks.list.searchPlaceholder')}
          perspective={{ tableId: 'webhooks.list' }}
          filters={filters}
          rowActions={(row) => (
            <RowActions items={[
              {
                label: t('common.edit'),
                href: `/backend/webhooks/${row.id}/edit`,
              },
              {
                label: t('common.delete'),
                destructive: true,
                onSelect: () => { void handleDelete(row) },
              },
            ]} />
          )}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          emptyState={{
            title: t('webhooks.list.empty.title'),
            description: t('webhooks.list.empty.description'),
            action: (
              <Button asChild variant="outline">
                <Link href="/backend/webhooks/create">{t('webhooks.list.empty.action')}</Link>
              </Button>
            ),
          }}
        />
      </PageBody>
    </Page>
  )
}
