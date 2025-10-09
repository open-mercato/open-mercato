"use client"
import * as React from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'

type Row = {
  entityId: string
  label: string
  baseCount: number
  indexCount: number
  ok: boolean
  job?: { status: 'idle'|'reindexing'|'purging'; startedAt?: string|null; finishedAt?: string|null }
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
      const working = r.job && (r.job.status === 'reindexing' || r.job.status === 'purging') && !r.job.finishedAt
      const ok = r.ok && !working
      return (
        <span className={working ? 'text-orange-600' : ok ? 'text-green-600' : 'text-muted-foreground'}>
          {working ? r.job!.status : ok ? 'In sync' : 'Out of sync'}
        </span>
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

  const { data, isLoading } = useQuery<Resp>({
    queryKey: ['query-index-status', scopeVersion],
    queryFn: async () => {
      const res = await apiFetch('/api/query_index/status')
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
          <Button variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ['query-index-status'] })}>Refresh</Button>
        </>
      )}
      columns={columns}
      data={rows}
      searchValue={search}
      onSearchChange={(v) => { setSearch(v); setPage(1) }}
      sortable
      sorting={sorting}
      onSortingChange={setSorting}
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
