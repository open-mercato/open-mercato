'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { VectorSearchHit } from '@open-mercato/vector'
import { fetchVectorResults } from '../utils'

type Row = VectorSearchHit
const MIN_QUERY_LENGTH = 2

const columns: ColumnDef<Row>[] = [
  {
    id: 'title',
    header: 'Result',
    cell: ({ row }) => {
      const item = row.original
      return (
        <div className="flex flex-col">
          <span className="font-medium">{item.presenter?.title ?? item.recordId}</span>
          {item.presenter?.subtitle ? (
            <span className="text-sm text-muted-foreground">{item.presenter.subtitle}</span>
          ) : null}
        </div>
      )
    },
    meta: { priority: 1 },
  },
  {
    id: 'entity',
    header: 'Entity',
    accessorKey: 'entityId',
    meta: { priority: 2 },
  },
  {
    id: 'score',
    header: 'Score',
    cell: ({ row }) => <span>{row.original.score.toFixed(2)}</span>,
    meta: { priority: 2 },
  },
]

function normalizeLinks(links?: Row['links']): { href: string; label?: string; kind?: string }[] {
  if (!Array.isArray(links)) return []
  return links.filter((link) => typeof link?.href === 'string') as Array<{ href: string; label?: string; kind?: string }>
}

function pickPrimaryLink(row: Row): string | null {
  if (row.url) return row.url
  const links = normalizeLinks(row.links)
  if (!links.length) return null
  const primary = links.find((link) => link.kind === 'primary')
  return (primary ?? links[0]).href
}

export function VectorSearchTable({ apiKeyAvailable, missingKeyMessage }: { apiKeyAvailable: boolean; missingKeyMessage: string }) {
  const router = useRouter()
  const [searchValue, setSearchValue] = React.useState('')
  const [rows, setRows] = React.useState<Row[]>([])
  const [page, setPage] = React.useState(1)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(apiKeyAvailable ? null : missingKeyMessage)
  const [reindexing, setReindexing] = React.useState(false)
  const debounceRef = React.useRef<number | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  const openRow = React.useCallback((row: Row) => {
    const href = pickPrimaryLink(row)
    if (!href) return
    router.push(href)
  }, [router])

  React.useEffect(() => {
    if (!apiKeyAvailable) {
      abortRef.current?.abort()
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      setRows([])
      setError(missingKeyMessage)
      setLoading(false)
      return
    }
    abortRef.current?.abort()
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    const trimmed = searchValue.trim()
    if (!trimmed) {
      setRows([])
      setError(null)
      setLoading(false)
      return
    }
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setRows([])
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    debounceRef.current = window.setTimeout(async () => {
      try {
        const data = await fetchVectorResults(trimmed, 50, controller.signal)
        setRows(data.results as Row[])
        setError(data.error ?? null)
        setPage(1)
      } catch (err: any) {
        if (controller.signal.aborted) return
        if (err?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Vector search failed')
        setRows([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 250)

    return () => {
      controller.abort()
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [searchValue, apiKeyAvailable, missingKeyMessage])

  const handleReindex = React.useCallback(async () => {
    if (!apiKeyAvailable || reindexing) return
    setReindexing(true)
    try {
      const res = await apiFetch('/api/vector/reindex', {
        method: 'POST',
        body: JSON.stringify({ purgeFirst: true }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        const message = typeof body?.error === 'string' ? body.error : 'Vector reindex failed'
        setError(message)
        return
      }
      if (typeof window !== 'undefined') {
        window.alert('Vector reindex started. Results will refresh once embeddings complete.')
      }
      const trimmed = searchValue.trim()
      if (trimmed.length >= MIN_QUERY_LENGTH) {
        try {
          const data = await fetchVectorResults(trimmed, 50)
          setRows(data.results as Row[])
          setError(data.error ?? null)
        } catch (err: any) {
          setError(err instanceof Error ? err.message : 'Vector search failed')
        }
      } else {
        setRows([])
      }
    } catch (err: any) {
      setError(err instanceof Error ? err.message : 'Vector reindex failed')
    } finally {
      setReindexing(false)
    }
  }, [apiKeyAvailable, reindexing, searchValue])

  return (
    <DataTable<Row>
      title="Vector Search Index"
      columns={columns}
      data={rows}
      searchValue={searchValue}
      onSearchChange={(value) => { setSearchValue(value); setPage(1) }}
      searchPlaceholder="Search vector index"
      isLoading={apiKeyAvailable ? loading : false}
      pagination={{ page, pageSize: rows.length || 1, total: rows.length, totalPages: 1, onPageChange: setPage }}
      actions={(
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!apiKeyAvailable || reindexing}
            onClick={handleReindex}
          >
            {reindexing ? 'Reindexing…' : 'Reindex vectors'}
          </Button>
          {error ? <span className="text-sm text-destructive">{error}</span> : null}
        </div>
      )}
      onRowClick={(row) => openRow(row)}
      rowActions={(row) => {
        const primaryHref = pickPrimaryLink(row)
        const items = [] as { label: string; href?: string }[]
        if (primaryHref) items.push({ label: 'Open', href: primaryHref })
        normalizeLinks(row.links).forEach((link) => {
          items.push({ label: link.label ?? link.href, href: link.href })
        })
        return <RowActions items={items} />
      }}
      embedded
    />
  )
}
