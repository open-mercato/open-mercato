"use client"
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

type EntityRow = {
  entityId: string
  label: string
  source: 'code' | 'custom'
  count: number
}

type EntitiesResponse = { items: EntityRow[] }

const columns: ColumnDef<EntityRow>[] = [
  { accessorKey: 'entityId', header: 'Entity', meta: { priority: 1 }, cell: ({ getValue }) => <span className="font-mono">{String(getValue())}</span> },
  { accessorKey: 'label', header: 'Label', meta: { priority: 2 } },
  { accessorKey: 'source', header: 'Source', meta: { priority: 3 } },
  { accessorKey: 'count', header: 'Fields', meta: { priority: 4 } },
]

function toCsv(rows: EntityRow[]) {
  const header = ['entityId','label','source','count']
  const esc = (s: string | number) => {
    const str = String(s ?? '')
    if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"'
    return str
  }
  const lines = [header.join(',')]
  for (const r of rows) lines.push([r.entityId, r.label, r.source, r.count].map(esc).join(','))
  return lines.join('\n')
}

export default function SystemEntitiesTable() {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'entityId', desc: false }])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')

  const { data, isLoading } = useQuery<EntitiesResponse>({
    queryKey: ['custom-entities'],
    queryFn: async () => {
      const res = await apiFetch('/api/entities/entities')
      if (!res.ok) throw new Error('Failed to load entities')
      return res.json()
    },
  })

  const rowsAll = data?.items || []
  // Filter to only show system entities (source: 'code')
  const systemRows = rowsAll.filter(row => row.source === 'code')
  const rows = React.useMemo(() => {
    if (!search) return systemRows
    const q = search.toLowerCase()
    return systemRows.filter(r => r.entityId.toLowerCase().includes(q) || r.label.toLowerCase().includes(q))
  }, [systemRows, search])

  return (
    <DataTable
      title="System Entities"
      actions={(
        <>
          <Button variant="outline" size="sm" onClick={() => {
            const csv = toCsv(rows)
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'entities-system.csv'
            a.click()
            URL.revokeObjectURL(url)
          }}>Export</Button>
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
            { label: 'Edit', href: `/backend/entities/system/${encodeURIComponent(row.entityId)}` },
          ]}
        />
      )}
      pagination={{ page, pageSize: 50, total: rows.length, totalPages: 1, onPageChange: setPage }}
      isLoading={isLoading}
    />
  )
}
