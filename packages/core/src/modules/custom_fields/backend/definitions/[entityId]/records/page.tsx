"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

type RecordsResponse = {
  items: any[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type CfDef = { key: string; label?: string; kind?: string }

function toCsvUrl(base: string, params: URLSearchParams) {
  const u = new URL(base, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  const p = new URLSearchParams(params)
  p.set('format', 'csv')
  u.search = p.toString()
  return u.toString()
}

function normalizeCell(v: any): string {
  if (Array.isArray(v)) return v.filter((x) => x != null && x !== '').join(', ')
  if (v === true) return 'Yes'
  if (v === false) return 'No'
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString()
  return String(v)
}

export default function RecordsPage({ params }: { params: { entityId?: string } }) {
  const entityId = decodeURIComponent(params?.entityId || '')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'id', desc: false }])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(50)
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<Record<string, any>>({})
  const [columns, setColumns] = React.useState<ColumnDef<any>[]>([])
  const [data, setData] = React.useState<any[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(false)
  const [cfDefs, setCfDefs] = React.useState<CfDef[]>([])

  // Load CF definitions for labeling and filters
  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await apiFetch(`/api/custom_fields/definitions?entityId=${encodeURIComponent(entityId)}`)
        const j = await res.json().catch(() => ({ items: [] }))
        if (!cancelled) setCfDefs((j.items || []).map((d: any) => ({ key: d.key, label: d.label, kind: d.kind })))
      } catch {}
    }
    if (entityId) load()
    return () => { cancelled = true }
  }, [entityId])

  // Fetch records whenever paging/sorting/filters change
  React.useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('entityId', entityId)
        params.set('page', String(page))
        params.set('pageSize', String(pageSize))
        const s = sorting?.[0]
        if (s?.id) {
          params.set('sortField', String(s.id))
          params.set('sortDir', s.desc ? 'desc' : 'asc')
        }
        // Flatten filter values into query params
        for (const [k, v] of Object.entries(filterValues)) {
          if (v == null) continue
          if (Array.isArray(v)) {
            if (v.length) params.set(k, v.join(','))
          } else if (typeof v === 'object') {
            // dateRange-like shapes are not supported generically here; skip
          } else {
            params.set(k, String(v))
          }
        }
        const res = await apiFetch(`/api/custom_fields/records?${params.toString()}`)
        if (!res.ok) throw new Error('Failed to load records')
        const j: RecordsResponse = await res.json()

        // Client-side quick search across visible scalar values
        let items = j.items || []
        if (search.trim()) {
          const q = search.trim().toLowerCase()
          items = items.filter((row: any) => {
            const values = Object.values(row || {})
            return values.some((v) => normalizeCell(v).toLowerCase().includes(q))
          })
        }

        // Build columns dynamically on first load or when shape changes
        const keys = Array.from(new Set(items.flatMap((it: any) => Object.keys(it || {}))))
        // Prefer predictable order: id, label-like, timestamps, then others; cf_ last
        const preferred = ['id', 'name', 'title', 'label', 'created_at', 'updated_at']
        const base = keys.filter((k) => !k.startsWith('cf_'))
        const cfs = keys.filter((k) => k.startsWith('cf_'))
        const ordered = [
          ...preferred.filter((k) => base.includes(k)),
          ...base.filter((k) => !preferred.includes(k)),
          ...cfs,
        ]
        const cfLabel = (k: string) => cfDefs.find((d) => `cf_${d.key}` === k)?.label || k
        const cols: ColumnDef<any>[] = ordered.map((k, idx) => ({
          accessorKey: k,
          header: k.startsWith('cf_') ? cfLabel(k) : k,
          meta: { priority: idx < 2 ? 1 : idx < 4 ? 2 : idx < 6 ? 3 : 4 },
          cell: ({ getValue }) => {
            const v = getValue() as any
            return <span>{normalizeCell(v)}</span>
          },
        }))
        if (!cancelled) {
          setColumns(cols)
          setData(items)
          setTotal(j.total)
          setTotalPages(j.totalPages)
        }
      } catch (e) {
        if (!cancelled) {
          setColumns([])
          setData([])
          setTotal(0)
          setTotalPages(1)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (entityId) run()
    return () => { cancelled = true }
  }, [entityId, page, pageSize, sorting, filterValues, search, cfDefs])

  const actions = (
    <>
      <Button asChild variant="outline" size="sm">
        <a
          href={(() => {
            const qp = new URLSearchParams({ entityId, page: String(page), pageSize: String(pageSize), sortField: String(sorting?.[0]?.id || 'id'), sortDir: sorting?.[0]?.desc ? 'desc' : 'asc' })
            for (const [k, v] of Object.entries(filterValues)) {
              if (v == null) continue
              if (Array.isArray(v)) { if (v.length) qp.set(k, v.join(',')) }
              else if (typeof v !== 'object') qp.set(k, String(v))
            }
            return toCsvUrl('/api/custom_fields/records', qp)
          })()}
          target="_blank"
          rel="noreferrer"
        >
          Export CSV
        </a>
      </Button>
    </>
  )

  return (
    <Page>
      <PageBody>
        <DataTable
          title={`Records: ${entityId}`}
          entityId={entityId}
          actions={actions}
          columns={columns}
          data={data}
          sortable
          sorting={sorting}
          onSortingChange={setSorting}
          searchValue={search}
          onSearchChange={(v) => { setSearch(v); setPage(1) }}
          onFiltersApply={(vals) => { setFilterValues(vals); setPage(1) }}
          onFiltersClear={() => { setFilterValues({}); setPage(1) }}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          isLoading={loading}
        />
      </PageBody>
    </Page>
  )
}
