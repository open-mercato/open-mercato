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
  baseCount: number
  indexCount: number
  ok: boolean
  job?: JobStatus
}

type Resp = { items: Row[] }

const columns: ColumnDef<Row>[] = [
  { id: 'entityId', header: 'Entity', accessorKey: 'entityId', meta: { priority: 1 } },
  { id: 'label', header: 'Label', accessorKey: 'label', meta: { priority: 2 } },
  { id: 'baseCount', header: 'Records', accessorKey: 'baseCount', meta: { priority: 2 } },
  { id: 'indexCount', header: 'Indexed', accessorKey: 'indexCount', meta: { priority: 2 } },
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

      const lines = [...scopeLine, ...partitionSummaries]

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
  )
}
