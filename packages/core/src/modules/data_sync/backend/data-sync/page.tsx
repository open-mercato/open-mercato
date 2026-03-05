"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SyncRunRow = {
  id: string
  integrationId: string
  entityType: string
  direction: 'import' | 'export'
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'paused'
  createdCount: number
  updatedCount: number
  failedCount: number
  createdAt: string
}

type ResponsePayload = {
  items: SyncRunRow[]
  total: number
  page: number
  totalPages: number
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-800',
  running: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-yellow-100 text-yellow-800',
  paused: 'bg-orange-100 text-orange-800',
}

export default function SyncRunsDashboardPage() {
  const router = useRouter()
  const [rows, setRows] = React.useState<SyncRunRow[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '20')
      if (filterValues.status) params.set('status', filterValues.status as string)
      if (filterValues.direction) params.set('direction', filterValues.direction as string)
      const fallback: ResponsePayload = { items: [], total: 0, page, totalPages: 1 }
      const call = await apiCall<ResponsePayload>(
        `/api/data_sync/runs?${params.toString()}`,
        undefined,
        { fallback },
      )
      if (!call.ok) {
        flash(t('data_sync.dashboard.loadError'), 'error')
        if (!cancelled) setIsLoading(false)
        return
      }
      const payload = call.result ?? fallback
      if (!cancelled) {
        setRows(Array.isArray(payload.items) ? payload.items : [])
        setTotal(payload.total || 0)
        setTotalPages(payload.totalPages || 1)
        setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, filterValues, reloadToken, scopeVersion, t])

  const handleCancel = React.useCallback(async (row: SyncRunRow) => {
    const call = await apiCall(`/api/data_sync/runs/${encodeURIComponent(row.id)}/cancel`, {
      method: 'POST',
    }, { fallback: null })
    if (call.ok) {
      flash(t('data_sync.runs.detail.cancelSuccess'), 'success')
      setReloadToken((token) => token + 1)
    } else {
      flash(t('data_sync.runs.detail.cancelError'), 'error')
    }
  }, [t])

  const handleRetry = React.useCallback(async (row: SyncRunRow) => {
    const call = await apiCall(`/api/data_sync/runs/${encodeURIComponent(row.id)}/retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromBeginning: false }),
    }, { fallback: null })
    if (call.ok) {
      flash(t('data_sync.runs.detail.retrySuccess'), 'success')
      setReloadToken((token) => token + 1)
    } else {
      flash(t('data_sync.runs.detail.retryError'), 'error')
    }
  }, [t])

  const handleFiltersApply = React.useCallback((values: FilterValues) => {
    const next: FilterValues = {}
    Object.entries(values).forEach(([key, value]) => {
      if (value !== undefined && value !== '') next[key] = value
    })
    setFilterValues(next)
    setPage(1)
  }, [])

  const handleFiltersClear = React.useCallback(() => {
    setFilterValues({})
    setPage(1)
  }, [])

  const filters: FilterDef[] = [
    {
      id: 'status',
      type: 'select',
      label: t('data_sync.dashboard.filters.status'),
      options: [
        { label: t('data_sync.dashboard.filters.allStatuses'), value: '' },
        { label: t('data_sync.dashboard.status.pending'), value: 'pending' },
        { label: t('data_sync.dashboard.status.running'), value: 'running' },
        { label: t('data_sync.dashboard.status.completed'), value: 'completed' },
        { label: t('data_sync.dashboard.status.failed'), value: 'failed' },
        { label: t('data_sync.dashboard.status.cancelled'), value: 'cancelled' },
      ],
    },
    {
      id: 'direction',
      type: 'select',
      label: t('data_sync.dashboard.columns.direction'),
      options: [
        { label: t('data_sync.dashboard.filters.allDirections'), value: '' },
        { label: t('data_sync.dashboard.direction.import'), value: 'import' },
        { label: t('data_sync.dashboard.direction.export'), value: 'export' },
      ],
    },
  ]

  const columns = React.useMemo<ColumnDef<SyncRunRow>[]>(() => [
    {
      accessorKey: 'integrationId',
      header: t('data_sync.dashboard.columns.integration'),
      cell: ({ row }) => <span className="font-medium text-sm">{row.original.integrationId}</span>,
    },
    {
      accessorKey: 'entityType',
      header: t('data_sync.dashboard.columns.entityType'),
    },
    {
      accessorKey: 'direction',
      header: t('data_sync.dashboard.columns.direction'),
      cell: ({ row }) => (
        <Badge variant="outline">
          {t(`data_sync.dashboard.direction.${row.original.direction}`)}
        </Badge>
      ),
    },
    {
      accessorKey: 'status',
      header: t('data_sync.dashboard.columns.status'),
      cell: ({ row }) => (
        <Badge variant="secondary" className={STATUS_STYLES[row.original.status] ?? ''}>
          {t(`data_sync.dashboard.status.${row.original.status}`)}
        </Badge>
      ),
    },
    {
      accessorKey: 'createdCount',
      header: t('data_sync.dashboard.columns.created'),
    },
    {
      accessorKey: 'updatedCount',
      header: t('data_sync.dashboard.columns.updated'),
    },
    {
      accessorKey: 'failedCount',
      header: t('data_sync.dashboard.columns.failed'),
    },
    {
      accessorKey: 'createdAt',
      header: t('data_sync.dashboard.columns.createdAt'),
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable
          title={t('data_sync.dashboard.title')}
          columns={columns}
          data={rows}
          filters={filters}
          filterValues={filterValues}
          onFiltersApply={handleFiltersApply}
          onFiltersClear={handleFiltersClear}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          perspective={{ tableId: 'data_sync.runs' }}
          onRowClick={(row) => {
            router.push(`/backend/data-sync/runs/${encodeURIComponent(row.id)}`)
          }}
          rowActions={(row) => (
            <RowActions items={[
              {
                id: 'view',
                label: t('data_sync.dashboard.actions.view'),
                onSelect: () => { router.push(`/backend/data-sync/runs/${encodeURIComponent(row.id)}`) },
              },
              ...(row.status === 'running' ? [{
                id: 'cancel',
                label: t('data_sync.runs.detail.cancel'),
                destructive: true,
                onSelect: () => { void handleCancel(row) },
              }] : []),
              ...(row.status === 'failed' ? [{
                id: 'retry',
                label: t('data_sync.runs.detail.retry'),
                onSelect: () => { void handleRetry(row) },
              }] : []),
            ]} />
          )}
          pagination={{ page, pageSize: 20, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
