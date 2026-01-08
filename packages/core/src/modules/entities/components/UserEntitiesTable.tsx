
"use client"
import * as React from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable, RowActions, Button } from '@open-mercato/ui'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type EntityRow = {
  entityId: string
  label: string
  source: 'code' | 'custom'
  count: number
  showInSidebar?: boolean
}

type EntitiesResponse = { items: EntityRow[] }

function buildColumns(t: (key: string, fallback: string) => string): ColumnDef<EntityRow>[] {
  return [
    { accessorKey: 'entityId', header: t('entities.user.table.column.entity', 'Entity'), meta: { priority: 1 }, cell: ({ getValue }) => <span className="font-mono">{String(getValue())}</span> },
    { accessorKey: 'label', header: t('entities.user.table.column.label', 'Label'), meta: { priority: 2 } },
    { accessorKey: 'source', header: t('entities.user.table.column.source', 'Source'), meta: { priority: 3 } },
    { accessorKey: 'count', header: t('entities.user.table.column.fields', 'Fields'), meta: { priority: 4 } },
    { 
      accessorKey: 'showInSidebar', 
      header: t('entities.user.table.column.inSidebar', 'In Sidebar'), 
      meta: { priority: 5 },
      cell: ({ getValue }) => (
        <span className={`px-2 py-1 rounded text-xs ${
          getValue() ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
        }`}>
          {getValue() ? t('common.yes', 'Yes') : t('common.no', 'No')}
        </span>
      )
    },
  ]
}

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
  const t = useT()
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'entityId', desc: false }])
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const scopeVersion = useOrganizationScopeVersion()
  
  const columns = React.useMemo(() => buildColumns(t), [t])

  const { data, isLoading } = useQuery<EntitiesResponse>({
    queryKey: ['custom-entities', scopeVersion],
    queryFn: async () => {
      return readApiResultOrThrow<EntitiesResponse>('/api/entities/entities', undefined, {
        errorMessage: 'Failed to load entities',
      })
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
      title={t('entities.user.table.title', 'User Entities')}
      actions={(
        <>
          <Button variant="outline" onClick={() => {
            const csv = toCsv(rows)
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'entities-user.csv'
            a.click()
            URL.revokeObjectURL(url)
          }}>{t('common.export', 'Export')}</Button>
          <Button asChild>
            <Link href="/backend/entities/user/create">{t('common.create', 'Create')}</Link>
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
      perspective={{ tableId: 'entities.user.list' }}
      rowActions={(row) => (
        <RowActions
          items={[
            { label: t('common.edit', 'Edit'), href: `/backend/entities/user/${encodeURIComponent(row.entityId)}` },
            { label: t('entities.user.table.actions.showRecords', 'Show records'), href: `/backend/entities/user/${encodeURIComponent(row.entityId)}/records` },
          ]}
        />
      )}
      pagination={{ page, pageSize: 50, total: rows.length, totalPages: 1, onPageChange: setPage }}
      isLoading={isLoading}
    />
  )
}
