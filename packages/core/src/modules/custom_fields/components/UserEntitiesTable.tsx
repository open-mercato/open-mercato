
"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable, RowActions, Button } from '@open-mercato/ui'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

type EntityRow = {
  entityId: string
  label: string
  source: 'code' | 'custom'
  count: number
  showInSidebar?: boolean
}

type EntitiesResponse = { items: EntityRow[] }

const columns: ColumnDef<EntityRow>[] = [
  { accessorKey: 'entityId', header: 'Entity', meta: { priority: 1 }, cell: ({ getValue }) => <span className="font-mono">{String(getValue())}</span> },
  { accessorKey: 'label', header: 'Label', meta: { priority: 2 } },
  { accessorKey: 'source', header: 'Source', meta: { priority: 3 } },
  { accessorKey: 'count', header: 'Fields', meta: { priority: 4 } },
  { 
    accessorKey: 'showInSidebar', 
    header: 'In Sidebar', 
    meta: { priority: 5 },
    cell: ({ getValue }) => (
      <span className={`px-2 py-1 rounded text-xs ${
        getValue() ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
      }`}>
        {getValue() ? 'Yes' : 'No'}
      </span>
    )
  },
]

function toCsv(rows: EntityRow[]) {
  const header = ['entityId','label','source','count','showInSidebar']
  const esc = (s: string | number | boolean) => {
    const str = String(s ?? '')
    if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"'
    return str
  }
  const lines = [header.join(',')]
  for (const r of rows) lines.push([r.entityId, r.label, r.source, r.count, r.showInSidebar || false].map(esc).join(','))
  return lines.join('\n')
}

export default function UserEntitiesTable() {
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'entityId', desc: false }])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')

  const { data, isLoading } = useQuery<EntitiesResponse>({
    queryKey: ['custom-entities'],
    queryFn: async () => {
      const res = await apiFetch('/api/custom_fields/entities')
      if (!res.ok) throw new Error('Failed to load entities')
      return res.json()
    },
  })

  const rowsAll = data?.items || []
  // Filter to only show user entities (source: 'custom')
  const userRows = rowsAll.filter(row => row.source === 'custom')
  const rows = React.useMemo(() => {
    if (!search) return userRows
    const q = search.toLowerCase()
    return userRows.filter(r => r.entityId.toLowerCase().includes(q) || r.label.toLowerCase().includes(q))
  }, [userRows, search])

  return (
    <DataTable
      title="User Entities"
      actions={(
        <>
          <Button variant="outline" size="sm" onClick={() => {
            const csv = toCsv(rows)
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'user-entities.csv'
            a.click()
            URL.revokeObjectURL(url)
          }}>Export</Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/backend/user-entities/create">Create</Link>
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
      rowActions={(row) => (
        <RowActions
          items={[
            { label: 'Edit', href: `/backend/user-entities/${encodeURIComponent(row.entityId)}` },
            { label: 'Show records', href: `/backend/user-entities/${encodeURIComponent(row.entityId)}/records` },
          ]}
        />
      )}
      pagination={{ page, pageSize: 50, total: rows.length, totalPages: 1, onPageChange: setPage }}
      isLoading={isLoading}
    />
  )
}
