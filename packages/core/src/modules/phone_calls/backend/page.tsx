"use client"

import * as React from 'react'
import type { SortingState } from '@tanstack/react-table'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { StatusBadge, type StatusMap } from '@open-mercato/ui/primitives/status-badge'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useProgressPoll } from '@open-mercato/ui/backend/progress/useProgressPoll'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { PHONE_CALL_RESOURCE_KIND } from '@open-mercato/shared/modules/phone_calls/types'

type PhoneCallRow = {
  id: string
  provider_key: string | null
  external_call_id: string | null
  direction: string | null
  status: string | null
  started_at: string | null
  duration_seconds: number | null
  ingest_status: string | null
}

type PhoneCallListResponse = {
  items?: PhoneCallRow[]
  total?: number
  page?: number
  totalPages?: number
}

const DIRECTION_VALUES = ['inbound', 'outbound', 'internal', 'unknown'] as const
const STATUS_VALUES = ['new', 'ringing', 'answered', 'missed', 'failed', 'completed', 'unknown'] as const

type PhoneCallStatusValue = typeof STATUS_VALUES[number]

function isPhoneCallStatus(value: string): value is PhoneCallStatusValue {
  return (STATUS_VALUES as readonly string[]).includes(value)
}

// Column id (snake_case accessorKey) -> API sortField key (camelCase, matches
// the route's sortFieldMap). Columns absent from this map are not sortable.
const SORT_FIELDS: Record<string, string> = {
  external_call_id: 'externalCallId',
  direction: 'direction',
  status: 'status',
  provider_key: 'providerKey',
  started_at: 'startedAt',
  duration_seconds: 'durationSeconds',
  ingest_status: 'ingestStatus',
}

const STATUS_TONE: StatusMap<PhoneCallStatusValue> = {
  completed: 'success',
  answered: 'success',
  ringing: 'warning',
  new: 'neutral',
  missed: 'error',
  failed: 'error',
  unknown: 'neutral',
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || Number.isNaN(seconds)) return '—'
  const total = Math.max(0, Math.floor(seconds))
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${mins}:${String(secs).padStart(2, '0')}`
}

export default function PhoneCallsPage() {
  const t = useT()
  const [rows, setRows] = React.useState<PhoneCallRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(50)
  const [search, setSearch] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'started_at', desc: true }])
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})

  const handleSortingChange = React.useCallback((next: SortingState) => {
    setSorting(next)
    setPage(1)
  }, [])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)

  // Ingest runs in a provider worker, so the rows land after the page did. Any job that
  // declares this resource kind wrote calls, whichever provider queued it.
  useAppEvent('progress.job.completed', (event) => {
    const meta = (event.payload as { meta?: Record<string, unknown> | null } | undefined)?.meta
    if (meta?.resourceKind !== PHONE_CALL_RESOURCE_KIND) return
    setReloadToken((token) => token + 1)
  }, [])

  // The event above is a live subscription with no replay: one emitted while the stream is
  // reconnecting is gone, and the grid keeps showing a range the ingest already filled. Polling
  // asks for state instead of waiting to be told, keyed by job id so nothing reloads twice.
  const { recentlyCompleted } = useProgressPoll()
  const seenJobIds = React.useRef<Set<string> | null>(null)
  React.useEffect(() => {
    const ingestJobs = recentlyCompleted.filter(
      (job) => (job.meta as { resourceKind?: string } | null | undefined)?.resourceKind === PHONE_CALL_RESOURCE_KIND,
    )
    // Jobs that finished before this page mounted are recorded without a reload; the initial
    // load already covers them.
    if (seenJobIds.current === null) {
      seenJobIds.current = new Set(ingestJobs.map((job) => job.id))
      return
    }
    const unseen = ingestJobs.filter((job) => !seenJobIds.current!.has(job.id))
    if (!unseen.length) return
    for (const job of unseen) seenJobIds.current.add(job.id)
    setReloadToken((token) => token + 1)
  }, [recentlyCompleted])

  const queryString = React.useMemo(() => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (search.trim()) params.set('q', search.trim())
    if (typeof filterValues.direction === 'string' && filterValues.direction) params.set('direction', filterValues.direction)
    if (typeof filterValues.status === 'string' && filterValues.status) params.set('status', filterValues.status)
    if (typeof filterValues.providerKey === 'string' && filterValues.providerKey.trim()) params.set('providerKey', filterValues.providerKey.trim())
    const started = filterValues.started as { from?: string; to?: string } | undefined
    if (started?.from) params.set('startedFrom', started.from)
    if (started?.to) params.set('startedTo', started.to)
    const activeSort = sorting[0]
    if (activeSort) {
      const sortField = SORT_FIELDS[activeSort.id]
      if (sortField) {
        params.set('sortField', sortField)
        params.set('sortDir', activeSort.desc ? 'desc' : 'asc')
      }
    }
    return params.toString()
  }, [page, pageSize, search, filterValues, sorting])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      const response = await apiCall<PhoneCallListResponse>(`/api/phone_calls/calls?${queryString}`).catch((err: unknown) => ({
        ok: false as const,
        result: { error: err instanceof Error ? err.message : undefined },
      }))
      if (cancelled) return
      if (!response.ok) {
        const errBody = response.result as { error?: string } | undefined
        setError(errBody?.error ?? t('phone_calls.calls.list.error', 'Failed to load phone calls'))
        setRows([])
        setTotal(0)
        setTotalPages(1)
      } else {
        const data = (response.result ?? {}) as PhoneCallListResponse
        setRows(Array.isArray(data.items) ? data.items : [])
        setTotal(typeof data.total === 'number' ? data.total : 0)
        setTotalPages(typeof data.totalPages === 'number' ? data.totalPages : 1)
      }
      setIsLoading(false)
    }
    void load()
    return () => { cancelled = true }
  }, [queryString, reloadToken, t])

  const filters = React.useMemo<FilterDef[]>(() => [
    {
      id: 'direction',
      label: t('phone_calls.calls.filters.direction', 'Direction'),
      type: 'select',
      options: DIRECTION_VALUES.map((value) => ({
        value,
        label: t(`phone_calls.calls.direction.${value}`, value),
      })),
    },
    {
      id: 'status',
      label: t('phone_calls.calls.filters.status', 'Status'),
      type: 'select',
      options: STATUS_VALUES.map((value) => ({
        value,
        label: t(`phone_calls.calls.status.${value}`, value),
      })),
    },
    {
      id: 'providerKey',
      label: t('phone_calls.calls.filters.provider', 'Provider'),
      type: 'text',
      placeholder: t('phone_calls.calls.filters.providerPlaceholder', 'Provider key'),
    },
    {
      id: 'started',
      label: t('phone_calls.calls.filters.started', 'Started'),
      type: 'dateRange',
    },
  ], [t])

  const columns = React.useMemo<ColumnDef<PhoneCallRow>[]>(() => [
    {
      accessorKey: 'external_call_id',
      header: t('phone_calls.calls.columns.callId', 'Call ID'),
      meta: { truncate: true, maxWidth: '240px' },
      cell: ({ row }) => (
        <span className="text-sm font-medium">{row.original.external_call_id || '—'}</span>
      ),
    },
    {
      accessorKey: 'direction',
      header: t('phone_calls.calls.columns.direction', 'Direction'),
      cell: ({ row }) => {
        const value = row.original.direction
        return <span className="text-sm">{value ? t(`phone_calls.calls.direction.${value}`, value) : '—'}</span>
      },
    },
    {
      accessorKey: 'status',
      header: t('phone_calls.calls.columns.status', 'Status'),
      cell: ({ row }) => {
        const value = row.original.status
        if (!value) return <span className="text-sm text-muted-foreground">—</span>
        return (
          <StatusBadge variant={STATUS_TONE[isPhoneCallStatus(value) ? value : 'unknown']} dot>
            {t(`phone_calls.calls.status.${value}`, value)}
          </StatusBadge>
        )
      },
    },
    {
      accessorKey: 'provider_key',
      header: t('phone_calls.calls.columns.provider', 'Provider'),
      cell: ({ row }) => <span className="text-sm">{row.original.provider_key || '—'}</span>,
    },
    {
      accessorKey: 'started_at',
      header: t('phone_calls.calls.columns.started', 'Started'),
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDateTime(row.original.started_at) ?? '—'}</span>,
    },
    {
      accessorKey: 'duration_seconds',
      header: t('phone_calls.calls.columns.duration', 'Duration'),
      cell: ({ row }) => <span className="text-sm tabular-nums">{formatDuration(row.original.duration_seconds)}</span>,
    },
    {
      accessorKey: 'ingest_status',
      header: t('phone_calls.calls.columns.ingestStatus', 'Ingest'),
      cell: ({ row }) => {
        const value = row.original.ingest_status
        return (
          <span className="text-sm text-muted-foreground">
            {value ? t(`phone_calls.calls.ingestStatus.${value}`, value) : '—'}
          </span>
        )
      },
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable<PhoneCallRow>
          title={t('phone_calls.calls.list.title', 'Phone Calls')}
          extensionTableId="phone_calls.calls"
          columns={columns}
          data={rows}
          isLoading={isLoading}
          error={error}
          sortable
          manualSorting
          sorting={sorting}
          onSortingChange={handleSortingChange}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('phone_calls.calls.list.searchPlaceholder', 'Search by call, conversation or provider')}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={(values) => { setFilterValues(values); setPage(1) }}
          onFiltersClear={() => { setFilterValues({}); setPage(1) }}
          emptyState={t('phone_calls.calls.list.empty', 'No phone calls yet. Calls appear here once they are ingested from a provider.')}
          pagination={{
            page,
            pageSize,
            total,
            totalPages,
            onPageChange: setPage,
            pageSizeOptions: [10, 25, 50, 100],
            onPageSizeChange: (size) => { setPageSize(size); setPage(1) },
          }}
        />
      </PageBody>
    </Page>
  )
}
