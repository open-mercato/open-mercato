"use client"
import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { filterCustomFieldDefs, useCustomFieldDefs } from '@open-mercato/ui/backend/utils/customFieldDefs'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import type { PreparedExport } from '@open-mercato/shared/lib/crud/exporters'
import type { FilterDef } from '@open-mercato/ui/backend/FilterBar'
import { ContextHelp } from '@open-mercato/ui/backend/ContextHelp'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import Link from 'next/link'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'

type RecordsResponse = {
  items: any[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

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
  const [rawData, setRawData] = React.useState<any[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(false)
  const scopeVersion = useOrganizationScopeVersion()
  const { data: cfDefs = [] } = useCustomFieldDefs(entityId, {
    enabled: Boolean(entityId),
    keyExtras: [scopeVersion],
  })

  // Fetch records whenever paging/sorting/filters change (do NOT refetch on cfDefs/search changes)
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
        if (!cancelled) {
          setRawData(j.items || [])
          setTotal(j.total)
          setTotalPages(j.totalPages)
        }
      } catch (e) {
        if (!cancelled) {
          setRawData([])
          setTotal(0)
          setTotalPages(1)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (entityId) run()
    return () => { cancelled = true }
  }, [entityId, page, pageSize, sorting, filterValues, scopeVersion])

  // Build columns from custom field definitions only (no data round-trip)
  React.useEffect(() => {
    const visibleDefs = filterCustomFieldDefs(cfDefs, 'list') as any
    const maxVisible = 10
    const cols: ColumnDef<any>[] = visibleDefs.map((d: any, idx: number) => ({
      accessorKey: d.key,
      header: d.label || d.key,
      meta: { priority: idx < 4 ? 1 : idx < 6 ? 2 : idx < 8 ? 3 : idx < maxVisible ? 4 : 5 },
      cell: ({ getValue }) => {
        const v = getValue() as any
        return <span className="truncate max-w-[24ch] inline-block align-top" title={normalizeCell(v)}>{normalizeCell(v)}</span>
      },
    }))
    // Ensure hidden 'id' column exists for sorting/state
    const hasIdCol = cols.some((c) => (c as any).accessorKey === 'id' || (c as any).id === 'id')
    if (!hasIdCol) cols.unshift({ accessorKey: 'id', header: 'ID', meta: { hidden: true, priority: 6 } } as any)
    setColumns(cols)
  }, [cfDefs])

  // Client-side quick search filtering without triggering server refetch
  const data = React.useMemo(() => {
    if (!search.trim()) return rawData
    const q = search.trim().toLowerCase()
    return (rawData || []).filter((row: any) => {
      const values = Object.values(row || {})
      return values.some((v) => normalizeCell(v).toLowerCase().includes(q))
    })
  }, [rawData, search])

  const viewExportColumns = React.useMemo(() => {
    return (columns || [])
      .map((col) => {
        const accessorKey = (col as any).accessorKey
        if (!accessorKey || typeof accessorKey !== 'string') return null
        if ((col as any).meta?.hidden) return null
        const header = typeof col.header === 'string'
          ? col.header
          : accessorKey.startsWith('cf_')
            ? accessorKey.slice(3)
            : accessorKey
        return { field: accessorKey, header }
      })
      .filter((col): col is { field: string; header: string } => !!col)
  }, [columns])

  const buildFullExportUrl = React.useCallback((format: DataTableExportFormat) => {
    const qp = new URLSearchParams({
      entityId,
      format,
      exportScope: 'full',
      all: 'true',
    })
    const sort = sorting?.[0]
    if (sort?.id) {
      qp.set('sortField', String(sort.id))
      qp.set('sortDir', sort.desc ? 'desc' : 'asc')
    }
    return `/api/entities/records?${qp.toString()}`
  }, [entityId, sorting])

  const exportConfig = React.useMemo(() => {
    const safeEntityId = entityId.replace(/[^a-z0-9_-]/gi, '_') || 'records'
    return {
      view: {
        description: 'Exports the current list respecting filters and column visibility.',
        prepare: async (): Promise<{ prepared: PreparedExport; filename: string }> => {
          const rowsForExport = data.map((row) => {
            const out: Record<string, unknown> = {}
            for (const col of viewExportColumns) {
              out[col.field] = (row as Record<string, unknown>)[col.field]
            }
            return out
          })
          const prepared: PreparedExport = {
            columns: viewExportColumns.map((col) => ({ field: col.field, header: col.header })),
            rows: rowsForExport,
          }
          return { prepared, filename: `${safeEntityId}_view` }
        },
      },
      full: {
        description: 'Exports raw records with every field and custom field included.',
        getUrl: (format: DataTableExportFormat) => buildFullExportUrl(format),
        filename: () => `${safeEntityId}_full`,
      },
    }
  }, [buildFullExportUrl, data, entityId, viewExportColumns])

  const hasAnyFormFields = React.useMemo(() => filterCustomFieldDefs(cfDefs, 'form').length > 0, [cfDefs])
  const actions = (
    <>
      <Button asChild variant="outline" size="sm">
        <Link href={`/backend/entities/user/${encodeURIComponent(entityId)}`}>
          Edit Entity Definition
        </Link>
      </Button>
      {hasAnyFormFields && (
        <Button asChild>
          <Link href={`/backend/entities/user/${encodeURIComponent(entityId)}/records/create`}>
            Create
          </Link>
        </Button>
      )}
    </>
  )

  // Ensure filters are visible even if no custom fields are marked filterable
  const baseFilters: FilterDef[] = React.useMemo(() => ([
    { id: 'id', label: 'ID', type: 'text' },
  ]), [])

  return (
    <Page>
      <PageBody>
        <ContextHelp bulb title="API: Manage Records via cURL" className="mb-4">
          <p className="mb-2">
            Interact with this custom entity via the backend API using cURL. Use API keys for machine-to-machine access—mint one from the{' '}
            <a className="underline" target="_blank" rel="noreferrer" href="https://docs.openmercato.com/user-guide/api-keys">
              Managing API keys guide
            </a>{' '}
            or the{' '}
            <a className="underline" target="_blank" rel="noreferrer" href="https://docs.openmercato.com/cli/api-keys">
              API keys CLI documentation
            </a>{' '}
            before running these calls.
          </p>
          <div className="space-y-2">
            <div>
              <div className="font-medium mb-1">1) Configure environment variables</div>
              <pre className="bg-muted p-3 rounded text-xs overflow-auto"><code>{`export BASE_URL="http://localhost:3000/api"
export API_KEY="<paste API key secret here>"           # scoped with entities.features
export ENTITY_ID="${entityId}"
export RECORD_ID="<record uuid>"`}</code></pre>
              <p className="text-muted-foreground mt-1">
                Need a new key? Follow the{' '}
                <a className="underline" target="_blank" rel="noreferrer" href="https://docs.openmercato.com/user-guide/api-keys">
                  Managing API keys
                </a>{' '}
                walkthrough or mint one via{' '}
                <a className="underline" target="_blank" rel="noreferrer" href="https://docs.openmercato.com/cli/api-keys">
                  mercato api_keys add
                </a>
                .
              </p>
            </div>

            <div>
              <div className="font-medium mb-1">2) List records</div>
              <pre className="bg-muted p-3 rounded text-xs overflow-auto"><code>{`curl -s -H "X-Api-Key: $API_KEY" \
  "$BASE_URL/entities/records?entityId=$ENTITY_ID" | jq`}</code></pre>
            </div>

            <div>
              <div className="font-medium mb-1">3) Read a single record (by id)</div>
              <pre className="bg-muted p-3 rounded text-xs overflow-auto"><code>{`curl -s -H "X-Api-Key: $API_KEY" \
  "$BASE_URL/entities/records?entityId=$ENTITY_ID&id=$RECORD_ID" | jq`}</code></pre>
              <p className="text-muted-foreground mt-1">Note: Response is a list; filter by <code>id</code> to get a single item.</p>
            </div>

            <div>
              <div className="font-medium mb-1">4) Create a record</div>
              <pre className="bg-muted p-3 rounded text-xs overflow-auto"><code>{`curl -s -X POST \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \\"entityId\\": \\"$ENTITY_ID\\",
    \\"values\\": {
      \\"field_one\\": \\"Example\\",
      \\"field_two\\": 123
    }
  }" \
  "$BASE_URL/entities/records" | jq`}</code></pre>
              <p className="text-muted-foreground mt-1">For custom entities, send field keys without the <code>cf_</code> prefix. The API normalizes this server-side.</p>
            </div>

            <div>
              <div className="font-medium mb-1">5) Update a record</div>
              <pre className="bg-muted p-3 rounded text-xs overflow-auto"><code>{`curl -s -X PUT \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \\"entityId\\": \\"$ENTITY_ID\\",
    \\"recordId\\": \\"$RECORD_ID\\",
    \\"values\\": {
      \\"field_one\\": \\"Updated\\"
    }
  }" \
  "$BASE_URL/entities/records" | jq`}</code></pre>
            </div>

            <div>
              <div className="font-medium mb-1">6) Delete a record</div>
              <pre className="bg-muted p-3 rounded text-xs overflow-auto"><code>{`curl -s -X DELETE \
  -H "X-Api-Key: $API_KEY" \
  "$BASE_URL/entities/records?entityId=$ENTITY_ID&recordId=$RECORD_ID" | jq`}</code></pre>
            </div>

            <div className="text-muted-foreground">
              Security notes:
              <ul className="list-disc pl-5 mt-1 space-y-1">
                <li>All endpoints require a valid API key. Keys inherit tenant, organization, and feature scope.</li>
                <li>Rotate keys regularly and delete unused ones in the admin UI.</li>
                <li>Store the secret in a secure vault; anyone with the header can act within the key&apos;s permissions.</li>
              </ul>
            </div>
          </div>
        </ContextHelp>
        <DataTable
          title={`Records: ${entityId}`}
          entityId={entityId}
          actions={actions}
          columns={columns}
          data={data}
          exporter={exportConfig}
          filters={baseFilters}
          filterValues={filterValues}
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
                    setRawData(j.items || [])
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
