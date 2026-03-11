"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Notice } from '@open-mercato/ui/primitives/Notice'
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

type SyncOption = {
  integrationId: string
  title: string
  description?: string | null
  providerKey?: string | null
  direction: 'import' | 'export' | 'bidirectional'
  supportedEntities: string[]
  hasCredentials: boolean
  isEnabled: boolean
  settingsPath: string
}

type SyncOptionsResponse = {
  items: SyncOption[]
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
  const [options, setOptions] = React.useState<SyncOption[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [isLoading, setIsLoading] = React.useState(true)
  const [isLoadingOptions, setIsLoadingOptions] = React.useState(true)
  const [selectedIntegrationId, setSelectedIntegrationId] = React.useState('')
  const [selectedEntityType, setSelectedEntityType] = React.useState('')
  const [selectedDirection, setSelectedDirection] = React.useState<'import' | 'export'>('import')
  const [batchSize, setBatchSize] = React.useState('100')
  const [fullSync, setFullSync] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({
    contextId: 'data_sync.dashboard',
  })

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

  React.useEffect(() => {
    let cancelled = false
    async function loadOptions() {
      setIsLoadingOptions(true)
      const fallback: SyncOptionsResponse = { items: [] }
      const call = await apiCall<SyncOptionsResponse>('/api/data_sync/options', undefined, { fallback })
      if (!cancelled) {
        if (!call.ok) {
          flash(t('data_sync.dashboard.loadError'), 'error')
          setOptions([])
          setIsLoadingOptions(false)
          return
        }

        const nextItems = Array.isArray(call.result?.items) ? call.result.items : []
        setOptions(nextItems)
        setSelectedIntegrationId((current) => {
          if (current && nextItems.some((item) => item.integrationId === current)) return current
          return nextItems[0]?.integrationId ?? ''
        })
        setIsLoadingOptions(false)
      }
    }

    void loadOptions()
    return () => { cancelled = true }
  }, [scopeVersion, t])

  const selectedIntegration = React.useMemo(
    () => options.find((item) => item.integrationId === selectedIntegrationId) ?? null,
    [options, selectedIntegrationId],
  )

  const entityOptions = React.useMemo(
    () => selectedIntegration?.supportedEntities ?? [],
    [selectedIntegration],
  )

  React.useEffect(() => {
    if (!selectedIntegration) {
      setSelectedEntityType('')
      return
    }
    setSelectedEntityType((current) => (
      current && selectedIntegration.supportedEntities.includes(current)
        ? current
        : (selectedIntegration.supportedEntities[0] ?? '')
    ))
    setSelectedDirection(selectedIntegration.direction === 'export' ? 'export' : 'import')
  }, [selectedIntegration])

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

  const handleStartSync = React.useCallback(async () => {
    if (!selectedIntegration || !selectedEntityType) return

    const parsedBatchSize = Number.parseInt(batchSize, 10)
    if (!Number.isFinite(parsedBatchSize) || parsedBatchSize < 1 || parsedBatchSize > 1000) {
      flash(t('data_sync.dashboard.start.invalidBatchSize', 'Batch size must be between 1 and 1000.'), 'error')
      return
    }

    try {
      const call = await runMutation({
        operation: () => apiCall<{ id: string }>('/api/data_sync/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            integrationId: selectedIntegration.integrationId,
            entityType: selectedEntityType,
            direction: selectedDirection,
            batchSize: parsedBatchSize,
            fullSync,
          }),
        }, { fallback: null }),
        mutationPayload: {
          integrationId: selectedIntegration.integrationId,
          entityType: selectedEntityType,
          direction: selectedDirection,
          batchSize: parsedBatchSize,
          fullSync,
        },
        context: {
          operation: 'create',
          actionId: 'start-sync-run',
          integrationId: selectedIntegration.integrationId,
        },
      })

      if (!call.ok || !call.result?.id) {
        flash((call.result as { error?: string } | null)?.error ?? t('data_sync.dashboard.start.error', 'Failed to start sync run'), 'error')
        return
      }

      flash(t('data_sync.dashboard.start.success', 'Sync run started'), 'success')
      setReloadToken((token) => token + 1)
      router.push(`/backend/data-sync/runs/${encodeURIComponent(call.result.id)}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : t('data_sync.dashboard.start.error', 'Failed to start sync run')
      flash(message, 'error')
    }
  }, [batchSize, fullSync, router, runMutation, selectedDirection, selectedEntityType, selectedIntegration, t])

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

  const canStartSelectedIntegration = Boolean(
    selectedIntegration
    && selectedEntityType
    && selectedIntegration.isEnabled
    && selectedIntegration.hasCredentials,
  )

  return (
    <Page>
      <PageBody className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('data_sync.dashboard.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 lg:grid-cols-5">
              <div className="space-y-2 lg:col-span-2">
                <label className="text-sm font-medium">{t('data_sync.dashboard.columns.integration')}</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedIntegrationId}
                  onChange={(event) => setSelectedIntegrationId(event.target.value)}
                  disabled={isLoadingOptions || options.length === 0}
                >
                  {options.length === 0 ? (
                    <option value="">{t('integrations.marketplace.noResults', 'No integrations found')}</option>
                  ) : null}
                  {options.map((item) => (
                    <option key={item.integrationId} value={item.integrationId}>
                      {item.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('data_sync.dashboard.columns.entityType')}</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedEntityType}
                  onChange={(event) => setSelectedEntityType(event.target.value)}
                  disabled={entityOptions.length === 0}
                >
                  {entityOptions.map((entityType) => (
                    <option key={entityType} value={entityType}>
                      {entityType}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('data_sync.dashboard.columns.direction')}</label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={selectedDirection}
                  onChange={(event) => setSelectedDirection(event.target.value === 'export' ? 'export' : 'import')}
                  disabled={selectedIntegration?.direction !== 'bidirectional'}
                >
                  <option value="import">{t('data_sync.dashboard.direction.import')}</option>
                  {(selectedIntegration?.direction === 'bidirectional' || selectedIntegration?.direction === 'export') ? (
                    <option value="export">{t('data_sync.dashboard.direction.export')}</option>
                  ) : null}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">{t('data_sync.dashboard.start.batchSize', 'Batch size')}</label>
                <Input
                  value={batchSize}
                  onChange={(event) => setBatchSize(event.target.value)}
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={fullSync}
                  onChange={(event) => setFullSync(event.target.checked)}
                />
                <span>{t('data_sync.dashboard.start.fullSync', 'Run as full sync')}</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {selectedIntegration ? (
                  <Button asChild variant="outline">
                    <Link href={selectedIntegration.settingsPath}>
                      {t('integrations.marketplace.configure')}
                    </Link>
                  </Button>
                ) : null}
                <Button
                  type="button"
                  onClick={() => void handleStartSync()}
                  disabled={!canStartSelectedIntegration}
                >
                  {t('data_sync.dashboard.start.submit', 'Start sync')}
                </Button>
              </div>
            </div>

            {selectedIntegration?.description ? (
              <p className="text-sm text-muted-foreground">{selectedIntegration.description}</p>
            ) : null}

            {selectedIntegration && !selectedIntegration.isEnabled ? (
              <Notice compact variant="warning">
                {t('integrations.detail.state.disabled', 'This integration is disabled. Enable it on the integration settings page before starting a sync.')}
              </Notice>
            ) : null}
            {selectedIntegration && !selectedIntegration.hasCredentials ? (
              <Notice compact variant="warning">
                {t('integrations.detail.credentials.notConfigured', 'Credentials are not configured yet. Save the integration credentials before starting a sync.')}
              </Notice>
            ) : null}
          </CardContent>
        </Card>

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
