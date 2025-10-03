"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { filterCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button, buttonVariants } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import Link from 'next/link'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

type RecordsResponse = {
  items: any[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type CfDef = { key: string; label?: string; kind?: string }

function toCsvUrl(base: string, params: URLSearchParams) {
  // Build a relative URL to avoid SSR/CSR origin mismatch hydration issues
  const p = new URLSearchParams(params)
  p.set('format', 'csv')
  const qs = p.toString()
  return qs ? `${base}?${qs}` : base
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
  const [showAllColumns, setShowAllColumns] = React.useState(false)

  // Load CF definitions for labeling and to respect per-field visibility (listVisible)
  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await apiFetch(`/api/entities/definitions?entityId=${encodeURIComponent(entityId)}`)
        const j = await res.json().catch(() => ({ items: [] }))
        if (!cancelled) setCfDefs((j.items || []).map((d: any) => ({ key: d.key, label: d.label, kind: d.kind, listVisible: (d as any).listVisible !== false })))
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
        const res = await apiFetch(`/api/entities/records?${params.toString()}`)
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

        // Build columns dynamically with heuristics to hide GUID/hash-like columns
        const keys = Array.from(new Set(items.flatMap((it: any) => Object.keys(it || {}))))
        // In user-defined entities, everything except technical fields is a custom field
        const isCustomEntity = true
        let base: string[] = []
        let cfs: string[] = []
        if (isCustomEntity) {
          const allowed = new Set(filterCustomFieldDefs(cfDefs as any, 'list').map((d: any) => d.key))
          const technical = new Set(['id', 'created_at', 'updated_at', 'deleted_at', 'organization_id', 'tenant_id'])
          // Exclude 'id' from columns; keep other non-technical keys visible (optionally filtered by defs)
          const visible = keys.filter((k) => !technical.has(k) && (allowed.size === 0 || allowed.has(k)))
          base = visible
          cfs = [] // do not use cf_ channel here
        } else {
          base = keys.filter((k) => !k.startsWith('cf_'))
          const allowedCf = new Set(filterCustomFieldDefs(cfDefs as any, 'list').map((d: any) => `cf_${d.key}`))
          cfs = keys.filter((k) => k.startsWith('cf_') && allowedCf.has(k))
        }

        const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        const hexLongRe = /^[0-9a-f]{24,}$/i
        const looksSensitive = (k: string) => /(password|token|secret|hash|salt|signature|key)$/i.test(k)
        const looksTechnicalId = (k: string) => /(^id$|_id$|^uuid$)/i.test(k)
        const sampleVal = (k: string) => {
          for (const row of items) {
            const v = (row as any)[k]
            if (v != null && v !== '') return Array.isArray(v) ? v[0] : v
          }
          return undefined
        }
        const isGuidLike = (k: string) => {
          const v = sampleVal(k)
          if (typeof v !== 'string') return false
          return uuidRe.test(v) || hexLongRe.test(v)
        }

        const rank = (k: string) => {
          // Lower number = higher priority
          if (['name','title','label'].includes(k)) return 0
          if (k === 'id') return 5 // de-prioritize id but not last
          if (k.endsWith('_at')) return 6
          if (k.startsWith('cf_')) return 7
          return 3
        }
        // Do not hide 'id' column completely; keep it available for sorting/state
        const hideByHeuristic = (k: string) => !showAllColumns && (looksSensitive(k) || (k !== 'id' && (looksTechnicalId(k) || isGuidLike(k))))

        const ordered = [
          ...['id','name','title','label','created_at','updated_at'].filter((k) => base.includes(k)),
          ...base.filter((k) => !['id','name','title','label','created_at','updated_at'].includes(k)).sort((a,b) => rank(a) - rank(b) || a.localeCompare(b)),
          ...cfs,
        ].filter((k) => !hideByHeuristic(k))

        // Limit to a reasonable number to fit width; remaining get higher responsive priority (hidden on smaller screens)
        const maxVisible = 10
        const cfLabel = (k: string) => {
          if (isCustomEntity) return cfDefs.find((d) => d.key === k)?.label || k
          return cfDefs.find((d) => `cf_${d.key}` === k)?.label || k
        }
        const cols: ColumnDef<any>[] = ordered.map((k, idx) => ({
          accessorKey: k,
          header: (isCustomEntity ? cfLabel(k) : (k.startsWith('cf_') ? cfLabel(k) : k)),
          // Priority: first 4 always, next hidden <sm, then <md, etc.
          meta: { priority: idx < 4 ? 1 : idx < 6 ? 2 : idx < 8 ? 3 : idx < maxVisible ? 4 : 5 },
          cell: ({ getValue }) => {
            const v = getValue() as any
            return <span className="truncate max-w-[24ch] inline-block align-top" title={normalizeCell(v)}>{normalizeCell(v)}</span>
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
  }, [entityId, page, pageSize, sorting, filterValues, search, cfDefs, showAllColumns])

  function ExportDropdown() {
    const buildExportUrl = (format: 'csv' | 'json' | 'xml') => {
      const qp = new URLSearchParams({
        entityId,
        sortField: String(sorting?.[0]?.id || 'id'),
        sortDir: sorting?.[0]?.desc ? 'desc' : 'asc',
        format,
        all: 'true',
      })
      for (const [k, v] of Object.entries(filterValues)) {
        if (v == null) continue
        if (Array.isArray(v)) {
          if (v.length) qp.set(k, v.join(','))
        } else if (typeof v !== 'object') qp.set(k, String(v))
      }
      return `/api/entities/records?${qp.toString()}`
    }

    const [open, setOpen] = React.useState(false)
    const btnRef = React.useRef<HTMLButtonElement>(null)
    const menuRef = React.useRef<HTMLDivElement>(null)

    React.useEffect(() => {
      if (!open) return
      const onDocClick = (e: MouseEvent) => {
        const t = e.target as Node
        if (menuRef.current && !menuRef.current.contains(t) && btnRef.current && !btnRef.current.contains(t)) {
          setOpen(false)
        }
      }
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setOpen(false)
          btnRef.current?.focus()
        }
      }
      document.addEventListener('mousedown', onDocClick)
      document.addEventListener('keydown', onKey)
      return () => {
        document.removeEventListener('mousedown', onDocClick)
        document.removeEventListener('keydown', onKey)
      }
    }, [open])

    return (
      <div className="relative inline-block">
        <button
          ref={btnRef}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          type="button"
        >
          Export
        </button>
        {open ? (
          <div
            ref={menuRef}
            role="menu"
            className="absolute right-0 mt-2 w-40 rounded-md border bg-background p-1 shadow z-20"
          >
            <a
              className="block w-full text-left px-2 py-1 text-sm rounded hover:bg-accent"
              href={buildExportUrl('csv')}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
            >
              CSV
            </a>
            <a
              className="block w-full text-left px-2 py-1 text-sm rounded hover:bg-accent"
              href={buildExportUrl('json')}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
            >
              JSON
            </a>
            <a
              className="block w-full text-left px-2 py-1 text-sm rounded hover:bg-accent"
              href={buildExportUrl('xml')}
              target="_blank"
              rel="noreferrer"
              onClick={() => setOpen(false)}
            >
              XML
            </a>
          </div>
        ) : null}
      </div>
    )
  }

  const hasAnyFormFields = React.useMemo(() => filterCustomFieldDefs(cfDefs as any, 'form').length > 0, [cfDefs])
  const actions = (
    <>
      {/* Remove "Show all columns" toggle for user entities */}
      {hasAnyFormFields && (
        <Button asChild size="sm">
          <Link href={`/backend/entities/user/${encodeURIComponent(entityId)}/records/create`}>
            Create
          </Link>
        </Button>
      )}
      <ExportDropdown />
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
          rowActions={(row) => (
            <RowActions
              items={[
                { label: 'Edit', href: `/backend/entities/user/${encodeURIComponent(entityId)}/records/${encodeURIComponent(String((row as any).id))}` },
                { label: 'Delete', destructive: true, onSelect: async () => {
                  try {
                    if (typeof window !== 'undefined') {
                      const ok = window.confirm('Delete this record?')
                      if (!ok) return
                    }
                    await apiFetch(`/api/entities/records?entityId=${encodeURIComponent(entityId)}&recordId=${encodeURIComponent(String((row as any).id))}`, { method: 'DELETE' })
                    // Refresh
                    const res = await apiFetch(`/api/entities/records?entityId=${encodeURIComponent(entityId)}&page=${page}&pageSize=${pageSize}`)
                    const j: RecordsResponse = await res.json()
                    setData(j.items || [])
                    setTotal(j.total || 0)
                    setTotalPages(j.totalPages || 1)
                    flash('Record has been removed', 'success')
                  } catch {}
                } },
              ]}
            />
          )}
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
