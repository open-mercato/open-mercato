"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

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
  ok: boolean
  job?: JobStatus
}

type ErrorLog = {
  id: string
  source: string
  handler: string
  entityType: string | null
  recordId: string | null
  tenantId: string | null
  organizationId: string | null
  message: string
  stack: string | null
  payload: unknown
  occurredAt: string
}

type StatusLog = {
  id: string
  source: string
  handler: string
  level: 'info' | 'warn'
  entityType: string | null
  recordId: string | null
  tenantId: string | null
  organizationId: string | null
  message: string
  details: unknown
  occurredAt: string
}

type Resp = { items: Row[]; errors: ErrorLog[]; logs: StatusLog[] }

function formatCount(value: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString()
}

function formatNumeric(value: number | null | undefined): string | null {
  if (value == null) return null
  return Number(value).toLocaleString()
}

function formatTimestamp(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
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

function buildScopeLabel(
  log: { tenantId: string | null; organizationId: string | null },
  t: Translator,
): string {
  const parts: string[] = []
  if (log.tenantId) parts.push(t('query_index.table.errors.scope.tenant', { tenantId: log.tenantId }))
  if (log.organizationId) parts.push(t('query_index.table.errors.scope.organization', { organizationId: log.organizationId }))
  return parts.join(' · ')
}

function formatPayload(value: unknown): string | null {
  if (value == null) return null
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    if (typeof value === 'string') return value
    return String(value)
  }
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
      const res = await apiFetch(url)
      if (!res.ok) throw new Error(t('query_index.table.errors.loadFailed'))
      return res.json()
    },
    refetchInterval: 4000,
  })

  const rowsAll = data?.items || []
  const errors = data?.errors || []
  const logs = data?.logs || []
  const rows = React.useMemo(() => {
    if (!search) return rowsAll
    const q = search.toLowerCase()
    return rowsAll.filter((r) => r.entityId.toLowerCase().includes(q) || r.label.toLowerCase().includes(q))
  }, [rowsAll, search])

  const trigger = React.useCallback(
    async (action: 'reindex' | 'purge', entityId: string, opts?: { force?: boolean }) => {
      const body: Record<string, unknown> = { entityType: entityId }
      if (opts?.force) body.force = true
      const res = await apiFetch(`/api/query_index/${action}`, { method: 'POST', body: JSON.stringify(body) })
      if (!res.ok && typeof window !== 'undefined') {
        const label =
          action === 'purge' ? t('query_index.table.actions.purge') : t('query_index.table.actions.reindex')
        window.alert(t('query_index.table.errors.actionFailed', { action: label }))
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

      let res: Response
      if (action === 'reindex') {
        res = await apiFetch('/api/vector/reindex', {
          method: 'POST',
          body: JSON.stringify({ entityId, purgeFirst: true }),
        })
      } else {
        const url = `/api/vector/index?entityId=${encodeURIComponent(entityId)}`
        res = await apiFetch(url, { method: 'DELETE' })
      }

      if (!res.ok && typeof window !== 'undefined') {
        const label = action === 'purge'
          ? t('query_index.table.actions.vectorPurge')
          : t('query_index.table.actions.vectorReindex')
        window.alert(t('query_index.table.errors.actionFailed', { action: label }))
      }
      qc.invalidateQueries({ queryKey: ['query-index-status'] })
    },
    [qc, t],
  )

  return (
    <div className="space-y-6">
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

          return <RowActions items={items} />
        }}
        pagination={{ page, pageSize: 50, total: rows.length, totalPages: 1, onPageChange: setPage }}
        isLoading={isLoading}
      />

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-medium">{t('query_index.table.logs.title')}</h2>
          <p className="text-xs text-muted-foreground">
            {t('query_index.table.logs.subtitle')}
          </p>
        </div>
        {logs.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            {t('query_index.table.logs.empty')}
          </div>
        ) : (
          <div className="max-h-72 overflow-x-auto overflow-y-auto">
            <table className="w-full table-fixed text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left">
                  <th className="w-40 px-4 py-2 font-medium">{t('query_index.table.logs.columns.timestamp')}</th>
                  <th className="w-28 px-4 py-2 font-medium">{t('query_index.table.logs.columns.source')}</th>
                  <th className="px-4 py-2 font-medium">{t('query_index.table.logs.columns.message')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const timestamp = formatTimestamp(log.occurredAt)
                  const scopeLabel = buildScopeLabel(log, t)
                  const detailsText = formatPayload(log.details)
                  const levelLabel = t(`query_index.table.logs.level.${log.level}`)
                  const badgeBase = 'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase'
                  const badgeTone =
                    log.level === 'warn'
                      ? 'bg-orange-100 text-orange-700'
                      : 'bg-muted text-muted-foreground'
                  const badgeClass = `${badgeBase} ${badgeTone}`
                  return (
                    <tr key={log.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-4 py-2 align-top">{timestamp}</td>
                      <td className="px-4 py-2 align-top">
                        <div className="font-medium">{log.source}</div>
                        <div className="break-all text-muted-foreground">{log.handler}</div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="break-words font-medium">{log.message}</span>
                            <span className={badgeClass}>{levelLabel}</span>
                          </div>
                          <div className="break-words text-muted-foreground">
                            {log.entityType ?? '—'}
                            {log.recordId ? ` · ${log.recordId}` : ''}
                            {scopeLabel ? ` · ${scopeLabel}` : ''}
                          </div>
                          {detailsText && (
                            <details className="mt-1 space-y-2">
                              <summary className="cursor-pointer select-none text-muted-foreground">
                                {t('query_index.table.logs.viewDetails')}
                              </summary>
                              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted/80 p-2 text-[11px] leading-tight">
                                {detailsText}
                              </pre>
                            </details>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-medium">{t('query_index.table.errors.title')}</h2>
          <p className="text-xs text-muted-foreground">
            {t('query_index.table.errors.subtitle')}
          </p>
        </div>
        {errors.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            {t('query_index.table.errors.empty')}
          </div>
        ) : (
          <div className="max-h-72 overflow-x-auto overflow-y-auto">
            <table className="w-full table-fixed text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left">
                  <th className="w-40 px-4 py-2 font-medium">{t('query_index.table.errors.columns.timestamp')}</th>
                  <th className="w-28 px-4 py-2 font-medium">{t('query_index.table.errors.columns.source')}</th>
                  <th className="px-4 py-2 font-medium">{t('query_index.table.errors.columns.details')}</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((error) => {
                  const timestamp = formatTimestamp(error.occurredAt)
                  const scopeLabel = buildScopeLabel(error, t)
                  const payloadText = formatPayload(error.payload)
                  const stackText = error.stack ? error.stack.trim() : null
                  return (
                    <tr key={error.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-4 py-2 align-top">{timestamp}</td>
                      <td className="px-4 py-2 align-top">
                        <div className="font-medium">{error.source}</div>
                        <div className="break-all text-muted-foreground">{error.handler}</div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="flex flex-col gap-1">
                          <div className="break-words font-medium">{error.message}</div>
                          <div className="break-words text-muted-foreground">
                            {error.entityType ?? '—'}
                            {error.recordId ? ` · ${error.recordId}` : ''}
                            {scopeLabel ? ` · ${scopeLabel}` : ''}
                          </div>
                          {(payloadText || stackText) && (
                            <details className="mt-1 space-y-2">
                              <summary className="cursor-pointer select-none text-muted-foreground">
                                {t('query_index.table.errors.viewDetails')}
                              </summary>
                              {payloadText && (
                                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted/80 p-2 text-[11px] leading-tight">
                                  {payloadText}
                                </pre>
                              )}
                              {stackText && (
                                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-muted/80 p-2 text-[11px] leading-tight">
                                  {stackText}
                                </pre>
                              )}
                            </details>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
