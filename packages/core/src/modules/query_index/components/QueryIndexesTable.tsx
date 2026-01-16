"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type Translator = (key: string, params?: Record<string, string | number>) => string

type PartitionStatus = {
  partitionIndex: number | null
  partitionCount: number | null
  status: 'reindexing' | 'purging' | 'stalled' | 'completed'
  processedCount?: number | null
  totalCount?: number | null
  heartbeatAt?: string | null
  startedAt?: string | null
  finishedAt?: string | null
}

type JobStatus = {
  status: 'idle' | 'reindexing' | 'purging' | 'stalled'
  startedAt?: string | null
  finishedAt?: string | null
  heartbeatAt?: string | null
  processedCount?: number | null
  totalCount?: number | null
  partitions?: PartitionStatus[]
  scope?: {
    status?: 'reindexing' | 'purging' | 'stalled' | 'completed' | null
    processedCount?: number | null
    totalCount?: number | null
  } | null
}

type Row = {
  entityId: string
  label: string
  baseCount: number | null
  indexCount: number | null
  vectorCount: number | null
  vectorEnabled: boolean
  fulltextCount: number | null
  fulltextEnabled: boolean
  ok: boolean
  job?: JobStatus
}

type Resp = { items: Row[] }

function formatCount(value: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString()
}

function formatNumeric(value: number | null | undefined): string | null {
  if (value == null) return null
  return Number(value).toLocaleString()
}

function formatProgressLabel(
  processed: number | null | undefined,
  total: number | null | undefined,
  t: Translator,
): string | null {
  const processedText = formatNumeric(processed)
  if (!processedText) return null
  const totalText = formatNumeric(total)
  if (totalText) return t('query_index.table.status.progress', { processed: processedText, total: totalText })
  return t('query_index.table.status.progressSingle', { processed: processedText })
}

function translateJobStatus(t: Translator, status: JobStatus['status'] | undefined, ok: boolean): string {
  if (!status || status === 'idle') {
    return ok ? t('query_index.table.status.in_sync') : t('query_index.table.status.out_of_sync')
  }
  if (status === 'reindexing') return t('query_index.table.status.reindexing')
  if (status === 'purging') return t('query_index.table.status.purging')
  if (status === 'stalled') return t('query_index.table.status.stalled')
  return ok ? t('query_index.table.status.in_sync') : t('query_index.table.status.out_of_sync')
}

function translateScopeStatus(
  t: Translator,
  status: PartitionStatus['status'] | JobStatus['status'] | undefined | null,
): string {
  if (status === 'reindexing') return t('query_index.table.status.scope.reindexing')
  if (status === 'purging') return t('query_index.table.status.scope.purging')
  if (status === 'stalled') return t('query_index.table.status.scope.stalled')
  return t('query_index.table.status.scope.completed')
}


function createColumns(t: Translator): ColumnDef<Row>[] {
  return [
    { id: 'entityId', header: () => t('query_index.table.columns.entity'), accessorKey: 'entityId', meta: { priority: 1 } },
    { id: 'label', header: () => t('query_index.table.columns.label'), accessorKey: 'label', meta: { priority: 2 } },
    {
      id: 'baseCount',
      header: () => t('query_index.table.columns.records'),
      accessorFn: (row) => row.baseCount ?? 0,
      cell: ({ row }) => <span>{formatCount(row.original.baseCount)}</span>,
      meta: { priority: 2 },
    },
    {
      id: 'indexCount',
      header: () => t('query_index.table.columns.indexed'),
      accessorFn: (row) => row.indexCount ?? 0,
      cell: ({ row }) => <span>{formatCount(row.original.indexCount)}</span>,
      meta: { priority: 2 },
    },
    {
      id: 'vectorCount',
      header: () => t('query_index.table.columns.vector'),
      accessorFn: (row) => (row.vectorEnabled ? row.vectorCount ?? 0 : -1),
      cell: ({ row }) => {
        const record = row.original
        if (!record.vectorEnabled) return <span>—</span>
        const ok = record.vectorCount != null && record.baseCount != null && record.vectorCount === record.baseCount
        const display = formatCount(record.vectorCount)
        const className = ok ? 'text-green-600' : 'text-orange-600'
        return <span className={className}>{display}</span>
      },
      meta: { priority: 2 },
    },
    {
      id: 'fulltextCount',
      header: () => t('query_index.table.columns.fulltext'),
      accessorFn: (row) => (row.fulltextEnabled ? row.fulltextCount ?? 0 : -1),
      cell: ({ row }) => {
        const record = row.original
        if (!record.fulltextEnabled) return <span>—</span>
        const ok = record.fulltextCount != null && record.baseCount != null && record.fulltextCount === record.baseCount
        const display = formatCount(record.fulltextCount)
        const className = ok ? 'text-green-600' : 'text-orange-600'
        return <span className={className}>{display}</span>
      },
      meta: { priority: 2 },
    },
    {
      id: 'status',
      header: () => t('query_index.table.columns.status'),
      cell: ({ row }) => {
        const record = row.original
        const job = record.job
        const partitions = job?.partitions ?? []
        const ok = record.ok && (!job || job.status === 'idle')
        const statusText = translateJobStatus(t, job?.status, ok)
        const jobProgress = job ? formatProgressLabel(job.processedCount ?? null, job.totalCount ?? null, t) : null
        const label = jobProgress
          ? t('query_index.table.status.withProgress', { status: statusText, progress: jobProgress })
          : statusText
        const className = job
          ? job.status === 'stalled'
            ? 'text-red-600'
            : job.status === 'reindexing' || job.status === 'purging'
              ? 'text-orange-600'
              : ok
                ? 'text-green-600'
                : 'text-muted-foreground'
          : ok
            ? 'text-green-600'
            : 'text-muted-foreground'

        const lines: string[] = []

        if (job?.scope && partitions.length <= 1) {
          const scopeStatus = translateScopeStatus(t, job.scope.status ?? null)
          const scopeProgress = formatProgressLabel(job.scope.processedCount ?? null, job.scope.totalCount ?? null, t)
          const scopeLabel = t('query_index.table.status.scopeLabel')
          lines.push(`${scopeLabel}: ${scopeStatus}${scopeProgress ? ` (${scopeProgress})` : ''}`)
        }

        if (partitions.length > 1) {
          for (const part of partitions) {
            const partitionLabel =
              part.partitionIndex != null
                ? t('query_index.table.status.partitionLabel', { index: Number(part.partitionIndex) + 1 })
                : t('query_index.table.status.scopeLabel')
            const partitionStatus = translateScopeStatus(t, part.status)
            const partitionProgress = formatProgressLabel(part.processedCount ?? null, part.totalCount ?? null, t)
            lines.push(`${partitionLabel}: ${partitionStatus}${partitionProgress ? ` (${partitionProgress})` : ''}`)
          }
        }

        if (record.vectorEnabled) {
          const vectorLabel = t('query_index.table.status.vectorLabel')
          const vectorCount = formatCount(record.vectorCount)
          const vectorTotal = record.baseCount != null ? formatCount(record.baseCount) : null
          const vectorValue = vectorTotal
            ? t('query_index.table.status.vectorValue', { count: vectorCount, total: vectorTotal })
            : vectorCount
          lines.push(`${vectorLabel}: ${vectorValue}`)
        }

        return (
          <div className="space-y-1">
            <span className={className}>{label}</span>
            {lines.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {lines.map((line, idx) => (
                  <div key={idx}>{line}</div>
                ))}
              </div>
            )}
          </div>
        )
      },
      meta: { priority: 1 },
    },
  ]
}

export default function QueryIndexesTable() {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'entityId', desc: false }])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [refreshSeq, setRefreshSeq] = React.useState(0)
  const t = useT()
  const columns = React.useMemo(() => createColumns(t), [t])

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ['query-index-status', scopeVersion, refreshSeq],
    queryFn: async () => {
      const baseUrl = '/api/query_index/status'
      const url = refreshSeq > 0 ? `${baseUrl}?refresh=${refreshSeq}` : baseUrl
      return readApiResultOrThrow<Resp>(
        url,
        undefined,
        { errorMessage: t('query_index.table.errors.loadFailed') },
      )
    },
    refetchInterval: 4000,
  })

  const rowsAll = data?.items || []
  const rows = React.useMemo(() => {
    if (!search) return rowsAll
    const q = search.toLowerCase()
    return rowsAll.filter((r) => r.entityId.toLowerCase().includes(q) || r.label.toLowerCase().includes(q))
  }, [rowsAll, search])

  const trigger = React.useCallback(
    async (action: 'reindex' | 'purge', entityId: string, opts?: { force?: boolean }) => {
      const body: Record<string, unknown> = { entityType: entityId }
      if (opts?.force) body.force = true
      const actionLabel =
        action === 'purge' ? t('query_index.table.actions.purge') : t('query_index.table.actions.reindex')
      const errorMessage = t('query_index.table.errors.actionFailed', { action: actionLabel })
      try {
        await apiCallOrThrow(`/api/query_index/${action}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }, { errorMessage })
      } catch (err) {
        console.error('query_index.table.trigger', err)
        if (typeof window !== 'undefined') {
          const message = err instanceof Error ? err.message : errorMessage
          window.alert(message)
        }
      }
      qc.invalidateQueries({ queryKey: ['query-index-status'] })
    },
    [qc, t],
  )

  const triggerVector = React.useCallback(
    async (action: 'reindex' | 'purge', entityId: string) => {
      if (action === 'purge' && typeof window !== 'undefined') {
        const confirmed = window.confirm(t('query_index.table.confirm.vectorPurge'))
        if (!confirmed) return
      }

      const actionLabel = action === 'purge'
        ? t('query_index.table.actions.vectorPurge')
        : t('query_index.table.actions.vectorReindex')
      const errorMessage = t('query_index.table.errors.actionFailed', { action: actionLabel })
      try {
        if (action === 'reindex') {
          await apiCallOrThrow('/api/vector/reindex', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ entityId }),
          }, { errorMessage })
        } else {
          const url = `/api/vector/index?entityId=${encodeURIComponent(entityId)}`
          await apiCallOrThrow(url, { method: 'DELETE' }, { errorMessage })
        }
      } catch (err) {
        console.error('query_index.table.vectorAction', err)
        if (typeof window !== 'undefined') {
          const message = err instanceof Error ? err.message : errorMessage
          window.alert(message)
        }
      }
      qc.invalidateQueries({ queryKey: ['query-index-status'] })
    },
    [qc, t],
  )

  const triggerFulltext = React.useCallback(
    async (action: 'reindex' | 'purge', entityId: string) => {
      if (action === 'purge' && typeof window !== 'undefined') {
        const confirmed = window.confirm(t('query_index.table.confirm.fulltextPurge'))
        if (!confirmed) return
      }

      const actionLabel = action === 'purge'
        ? t('query_index.table.actions.fulltextPurge')
        : t('query_index.table.actions.fulltextReindex')
      const errorMessage = t('query_index.table.errors.actionFailed', { action: actionLabel })
      try {
        await apiCallOrThrow('/api/search/reindex', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: action === 'purge' ? 'clear' : 'reindex',
            entityId,
          }),
        }, { errorMessage })
      } catch (err) {
        console.error('query_index.table.fulltextAction', err)
        if (typeof window !== 'undefined') {
          const message = err instanceof Error ? err.message : errorMessage
          window.alert(message)
        }
      }
      qc.invalidateQueries({ queryKey: ['query-index-status'] })
    },
    [qc, t],
  )

  return (
    <DataTable
      title={t('query_index.nav.queryIndexes')}
      actions={(
        <>
          <Button
            variant="outline"
            onClick={() => {
              setRefreshSeq((v) => v + 1)
              qc.invalidateQueries({ queryKey: ['query-index-status'] })
            }}
          >
            {t('query_index.table.refresh')}
          </Button>
        </>
      )}
      columns={columns}
      data={rows}
      searchValue={search}
      searchPlaceholder={t('query_index.table.searchPlaceholder')}
      onSearchChange={(value) => {
        setSearch(value)
        setPage(1)
      }}
      sortable
      sorting={sorting}
      onSortingChange={setSorting}
      perspective={{ tableId: 'query_index.status.list' }}
      rowActions={(row) => {
        const items: Array<{ label: string; onSelect: () => void; destructive?: boolean }> = [
          { label: t('query_index.table.actions.reindex'), onSelect: () => trigger('reindex', row.entityId) },
          {
            label: t('query_index.table.actions.reindexForce'),
            onSelect: () => trigger('reindex', row.entityId, { force: true }),
          },
          {
            label: t('query_index.table.actions.purge'),
            destructive: true,
            onSelect: () => trigger('purge', row.entityId),
          },
        ]

        if (row.vectorEnabled) {
          items.push(
            {
              label: t('query_index.table.actions.vectorReindex'),
              onSelect: () => triggerVector('reindex', row.entityId),
            },
            {
              label: t('query_index.table.actions.vectorPurge'),
              destructive: true,
              onSelect: () => triggerVector('purge', row.entityId),
            },
          )
        }

        if (row.fulltextEnabled) {
          items.push(
            {
              label: t('query_index.table.actions.fulltextReindex'),
              onSelect: () => triggerFulltext('reindex', row.entityId),
            },
            {
              label: t('query_index.table.actions.fulltextPurge'),
              destructive: true,
              onSelect: () => triggerFulltext('purge', row.entityId),
            },
          )
        }

        return <RowActions items={items} />
      }}
      pagination={{ page, pageSize: 50, total: rows.length, totalPages: 1, onPageChange: setPage }}
      isLoading={isLoading}
    />
  )
}
