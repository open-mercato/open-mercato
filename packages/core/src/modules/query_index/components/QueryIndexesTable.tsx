"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'

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

type Resp = { items: Row[]; errors: ErrorLog[] }

const columns: ColumnDef<Row>[] = [
  { id: 'entityId', header: 'Entity', accessorKey: 'entityId', meta: { priority: 1 } },
  { id: 'label', header: 'Label', accessorKey: 'label', meta: { priority: 2 } },
  {
    id: 'baseCount',
    header: 'Records',
    accessorFn: (row) => row.baseCount ?? 0,
    cell: ({ row }) => <span>{formatCount(row.original.baseCount)}</span>,
    meta: { priority: 2 },
  },
  {
    id: 'indexCount',
    header: 'Indexed',
    accessorFn: (row) => row.indexCount ?? 0,
    cell: ({ row }) => <span>{formatCount(row.original.indexCount)}</span>,
    meta: { priority: 2 },
  },
  {
    id: 'vectorCount',
    header: 'Vector',
    accessorFn: (row) => (row.vectorEnabled ? row.vectorCount ?? 0 : -1),
    cell: ({ row }) => {
      const r = row.original
      if (!r.vectorEnabled) return <span>—</span>
      const ok = r.vectorCount != null && r.baseCount != null && r.vectorCount === r.baseCount
      const display = formatCount(r.vectorCount)
      const className = ok ? 'text-green-600' : 'text-orange-600'
      return <span className={className}>{display}</span>
    },
    meta: { priority: 2 },
  },
  {
    id: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const r = row.original as Row
      const job = r.job
      const partitions = job?.partitions ?? []
      const ok = r.ok && (!job || job.status === 'idle')
      const showJobProgress =
        job?.processedCount != null && job?.totalCount != null && job.totalCount > 0
      const progressLabel = showJobProgress
        ? ` (${job.processedCount!.toLocaleString()}/${job.totalCount!.toLocaleString()})`
        : ''
      let label = ok ? 'In sync' : 'Out of sync'
      if (job) {
        if (job.status === 'reindexing') label = `Reindexing${progressLabel}`
        else if (job.status === 'purging') label = `Purging${progressLabel}`
        else if (job.status === 'stalled') label = `Stalled${progressLabel || ''}`
        else if (!ok) label = 'Out of sync'
      }
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

      const scopeLine =
        job?.scope && partitions.length <= 1
          ? [
              `Scope: ${
                job.scope.status === 'reindexing'
                  ? 'Running'
                  : job.scope.status === 'purging'
                    ? 'Purging'
                    : job.scope.status === 'stalled'
                      ? 'Stalled'
                      : 'Done'
              }${
                job.scope.processedCount != null && job.scope.totalCount
                  ? ` (${job.scope.processedCount.toLocaleString()}/${job.scope.totalCount.toLocaleString()})`
                  : ''
              }`,
            ]
          : []

      const partitionSummaries =
        partitions.length > 1
          ? partitions.map((part) => {
              const partLabel = part.partitionIndex != null ? `P${Number(part.partitionIndex) + 1}` : 'Scope'
              const partProgress =
                part.totalCount && part.processedCount != null
                  ? `${part.processedCount.toLocaleString()}/${part.totalCount.toLocaleString()}`
                  : part.processedCount != null
                    ? `${part.processedCount.toLocaleString()}`
                    : null
              const stateLabel =
                part.status === 'reindexing'
                  ? 'Running'
                  : part.status === 'purging'
                    ? 'Purging'
                    : part.status === 'stalled'
                      ? 'Stalled'
                      : 'Done'
              return `${partLabel}: ${stateLabel}${partProgress ? ` (${partProgress})` : ''}`
            })
          : []

      const vectorSummary =
        r.vectorEnabled
          ? [
              `Vector: ${
                r.vectorCount != null ? r.vectorCount.toLocaleString() : '—'
              }${r.baseCount != null ? ` / ${r.baseCount.toLocaleString()}` : ''}`,
            ]
          : []

      const lines = [...scopeLine, ...partitionSummaries, ...vectorSummary]

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

function formatCount(value: number | null): string {
  if (value == null) return '—'
  return value.toLocaleString()
}

function formatTimestamp(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function buildScopeLabel(log: ErrorLog): string {
  const parts: string[] = []
  if (log.tenantId) parts.push(`tenant=${log.tenantId}`)
  if (log.organizationId) parts.push(`org=${log.organizationId}`)
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

export default function QueryIndexesTable() {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'entityId', desc: false }])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const qc = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [refreshSeq, setRefreshSeq] = React.useState(0)

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ['query-index-status', scopeVersion, refreshSeq],
    queryFn: async () => {
      const baseUrl = '/api/query_index/status'
      const url = refreshSeq > 0 ? `${baseUrl}?refresh=${refreshSeq}` : baseUrl
      const res = await apiFetch(url)
      if (!res.ok) throw new Error('Failed to load status')
      return res.json()
    },
    refetchInterval: 4000,
  })

  const rowsAll = data?.items || []
  const errors = data?.errors || []
  const rows = React.useMemo(() => {
    if (!search) return rowsAll
    const q = search.toLowerCase()
    return rowsAll.filter(r => r.entityId.toLowerCase().includes(q) || r.label.toLowerCase().includes(q))
  }, [rowsAll, search])

  const trigger = async (action: 'reindex'|'purge', entityId: string, opts?: { force?: boolean }) => {
    const body: any = { entityType: entityId }
    if (opts?.force) body.force = true
    const res = await apiFetch(`/api/query_index/${action}`, { method: 'POST', body: JSON.stringify(body) })
    if (!res.ok) alert(`Failed to ${action}`)
    qc.invalidateQueries({ queryKey: ['query-index-status'] })
  }

  return (
    <div className="space-y-6">
      <DataTable
        title="Query Indexes"
        actions={(
          <>
            <Button
              variant="outline"
              onClick={() => {
                setRefreshSeq((v) => v + 1)
                qc.invalidateQueries({ queryKey: ['query-index-status'] })
              }}
            >
              Refresh
            </Button>
          </>
        )}
        columns={columns}
        data={rows}
        searchValue={search}
        onSearchChange={(v) => { setSearch(v); setPage(1) }}
        sortable
        sorting={sorting}
        onSortingChange={setSorting}
        perspective={{ tableId: 'query_index.status.list' }}
        rowActions={(row) => (
          <RowActions
            items={[
              { label: 'Reindex', onSelect: () => trigger('reindex', row.entityId) },
              { label: 'Force Full Reindex', onSelect: () => trigger('reindex', row.entityId, { force: true }) },
              { label: 'Purge', destructive: true, onSelect: () => trigger('purge', row.entityId) },
            ]}
          />
        )}
        pagination={{ page, pageSize: 50, total: rows.length, totalPages: 1, onPageChange: setPage }}
        isLoading={isLoading}
      />

      <div className="overflow-hidden rounded-md border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-medium">Recent indexer errors</h2>
          <p className="text-xs text-muted-foreground">
            Last 100 errors recorded for query index and vector index jobs in this scope.
          </p>
        </div>
        {errors.length === 0 ? (
          <div className="px-4 py-6 text-xs text-muted-foreground">
            No recent errors recorded.
          </div>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full table-fixed text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left">
                  <th className="w-40 px-4 py-2 font-medium">Timestamp</th>
                  <th className="w-28 px-4 py-2 font-medium">Source</th>
                  <th className="px-4 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                {errors.map((error) => {
                  const timestamp = formatTimestamp(error.occurredAt)
                  const scopeLabel = buildScopeLabel(error)
                  const payloadText = formatPayload(error.payload)
                  const stackText = error.stack ? error.stack.trim() : null
                  return (
                    <tr key={error.id} className="border-b last:border-0">
                      <td className="px-4 py-2 align-top whitespace-nowrap">{timestamp}</td>
                      <td className="px-4 py-2 align-top whitespace-nowrap">
                        <div className="font-medium">{error.source}</div>
                        <div className="text-muted-foreground">{error.handler}</div>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <div className="flex flex-col gap-1">
                          <div className="font-medium">{error.message}</div>
                          <div className="text-muted-foreground">
                            {error.entityType ?? '—'}
                            {error.recordId ? ` · ${error.recordId}` : ''}
                            {scopeLabel ? ` · ${scopeLabel}` : ''}
                          </div>
                          {(payloadText || stackText) && (
                            <details className="mt-1 space-y-2">
                              <summary className="cursor-pointer select-none text-muted-foreground">
                                View technical details
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
