"use client"
import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'

type PushDeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'expired'

type Row = {
  id: string
  notification_type_id: string
  user_id: string
  provider: string
  token_snapshot: string
  status: PushDeliveryStatus
  attempts: number
  last_error: string | null
  created_at: string | null
  sent_at: string | null
}

type ResponsePayload = {
  items: Row[]
  total: number
  page?: number
  pageSize?: number
  totalPages: number
}

const statusVariant: StatusMap<PushDeliveryStatus> = {
  pending: 'info',
  sending: 'info',
  sent: 'success',
  failed: 'error',
  skipped: 'neutral',
  expired: 'warning',
}

function formatDate(value: string | null, t: (key: string) => string) {
  if (!value) return t('push_notifications.deliveries.noValue')
  try {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return t('push_notifications.deliveries.noValue')
    return date.toLocaleString()
  } catch {
    return t('push_notifications.deliveries.noValue')
  }
}

export default function PushDeliveriesListPage() {
  const [rows, setRows] = React.useState<Row[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [userOptions, setUserOptions] = React.useState<{ value: string; label: string; description?: string | null }[]>([])

  // Filter deliveries by recipient picked via name/email search instead of a raw UUID (mirrors the
  // devices list). Admins without auth.users.list degrade gracefully to no options.
  const loadUserOptions = React.useCallback(async (query?: string) => {
    const params = new URLSearchParams()
    params.set('page', '1')
    params.set('pageSize', '20')
    if (query && query.trim().length > 0) params.set('search', query.trim())
    const call = await apiCall<{ items?: { id: string; name?: string | null; email?: string | null }[] }>(
      `/api/auth/users?${params.toString()}`,
      { headers: { 'x-om-forbidden-redirect': '0' } },
      { fallback: null },
    ).catch(() => null)
    if (!call || !call.ok) return []
    const next = (call.result?.items ?? []).flatMap((item) => {
      if (!item || typeof item.id !== 'string' || !item.id.trim()) return []
      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null
      const email = typeof item.email === 'string' && item.email.trim() ? item.email.trim() : null
      const label = name ?? email ?? item.id
      return [{ value: item.id, label, description: email && email !== label ? email : null }]
    })
    setUserOptions((prev) => {
      const map = new Map(prev.map((opt) => [opt.value, opt]))
      for (const opt of next) map.set(opt.value, opt)
      return Array.from(map.values())
    })
    return next
  }, [])

  React.useEffect(() => { void loadUserOptions() }, [loadUserOptions, scopeVersion])

  // Reuse the picker cache to label the User column; rows whose owner isn't cached still show the id.
  const userLabelById = React.useMemo(
    () => new Map(userOptions.map((opt) => [opt.value, opt.label])),
    [userOptions],
  )

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('push_notifications.deliveries.columns.status'),
      type: 'select',
      options: [
        { value: 'pending', label: t('push_notifications.deliveries.status.pending') },
        { value: 'sending', label: t('push_notifications.deliveries.status.sending') },
        { value: 'sent', label: t('push_notifications.deliveries.status.sent') },
        { value: 'failed', label: t('push_notifications.deliveries.status.failed') },
        { value: 'skipped', label: t('push_notifications.deliveries.status.skipped') },
        { value: 'expired', label: t('push_notifications.deliveries.status.expired') },
      ],
    },
    {
      id: 'userId',
      label: t('push_notifications.deliveries.columns.user'),
      type: 'combobox',
      options: userOptions,
      loadOptions: loadUserOptions,
    },
    // A single created-at range picker (ISO `yyyy-MM-dd`) that maps to the ?from/?to query params.
    { id: 'createdRange', label: t('push_notifications.deliveries.filters.created'), type: 'dateRange' },
  ], [t, userOptions, loadUserOptions])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', '50')
        const status = typeof filterValues.status === 'string' ? filterValues.status.trim() : ''
        const userId = typeof filterValues.userId === 'string' ? filterValues.userId.trim() : ''
        const createdRange = (filterValues.createdRange ?? {}) as { from?: string; to?: string }
        const from = typeof createdRange.from === 'string' ? createdRange.from.trim() : ''
        const to = typeof createdRange.to === 'string' ? createdRange.to.trim() : ''
        if (status) params.set('status', status)
        if (userId) params.set('userId', userId)
        if (from) params.set('from', from)
        if (to) params.set('to', to)
        const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
        const call = await apiCall<ResponsePayload>(`/api/push_notifications/deliveries?${params.toString()}`, undefined, { fallback })
        if (!call.ok) {
          const errorPayload = call.result as { error?: string } | undefined
          const message = typeof errorPayload?.error === 'string' ? errorPayload.error : t('push_notifications.deliveries.error.loadFailed')
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
          const message = error instanceof Error ? error.message : t('push_notifications.deliveries.error.loadFailed')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, scopeVersion, filterValues, t])

  const columns = React.useMemo<ColumnDef<Row>[]>(() => [
    {
      accessorKey: 'status',
      header: t('push_notifications.deliveries.columns.status'),
      cell: ({ row }) => (
        <StatusBadge variant={statusVariant[row.original.status] ?? 'neutral'} dot>
          {t(`push_notifications.deliveries.status.${row.original.status}`)}
        </StatusBadge>
      ),
    },
    { accessorKey: 'notification_type_id', header: t('push_notifications.deliveries.columns.type') },
    {
      accessorKey: 'user_id',
      header: t('push_notifications.deliveries.columns.user'),
      cell: ({ row }) => {
        const userId = row.original.user_id
        const label = userLabelById.get(userId)
        return (
          // Stop the click bubbling to the row, whose default action opens the delivery detail.
          <Link
            href={`/backend/users/${encodeURIComponent(userId)}/edit`}
            className="text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {label ?? <code className="text-xs">{userId}</code>}
          </Link>
        )
      },
    },
    { accessorKey: 'provider', header: t('push_notifications.deliveries.columns.provider') },
    {
      accessorKey: 'attempts',
      header: t('push_notifications.deliveries.columns.attempts'),
    },
    {
      accessorKey: 'created_at',
      header: t('push_notifications.deliveries.columns.created'),
      cell: ({ row }) => formatDate(row.original.created_at, t),
    },
    {
      accessorKey: 'sent_at',
      header: t('push_notifications.deliveries.columns.sent'),
      cell: ({ row }) => formatDate(row.original.sent_at, t),
    },
  ], [t, userLabelById])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('push_notifications.deliveries.title')}
          columns={columns}
          data={rows}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => { setFilterValues(values); setPage(1) }}
          onFiltersClear={() => { setFilterValues({}); setPage(1) }}
          perspective={{ tableId: 'push_notifications.deliveries' }}
          onRowClick={(row) => { window.location.href = `/backend/push_notifications/${row.id}` }}
          pagination={{ page, pageSize: 50, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
          emptyState={t('push_notifications.deliveries.empty')}
        />
      </PageBody>
    </Page>
  )
}
