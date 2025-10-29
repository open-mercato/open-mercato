'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import * as LucideIcons from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { VectorSearchHit, VectorIndexEntry } from '@open-mercato/vector'
import { cn } from '@open-mercato/shared/lib/utils'
import { fetchVectorResults, fetchVectorIndexEntries } from '../utils'

type Row = {
  entityId: string
  recordId: string
  driverId: string
  score: number | null
  url: string | null
  presenter: VectorSearchHit['presenter'] | null
  links: VectorSearchHit['links'] | null
  updatedAt: string | null
  metadata: Record<string, unknown> | null
}
const MIN_QUERY_LENGTH = 2

const columns: ColumnDef<Row>[] = [
  {
    id: 'title',
    header: 'Result',
    cell: ({ row }) => {
      const item = row.original
      const iconName = item.presenter?.icon
      const Icon = iconName ? resolveIcon(iconName) : null
      const typeLabel = formatEntityId(item.entityId)
      const snapshot = item.presenter?.subtitle ?? extractSnapshot(item.metadata)
      const links = normalizeLinks(item.links)
      return (
        <div className="flex flex-col">
          <div className="flex items-start gap-3">
            {Icon ? <Icon className="mt-0.5 h-5 w-5 text-muted-foreground" /> : null}
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.presenter?.title ?? item.recordId}</span>
                <span className="rounded border border-muted-foreground/40 px-2 py-0.5 text-xs text-muted-foreground">
                  {typeLabel}
                </span>
              </div>
              {snapshot ? (
                <span className="text-sm text-muted-foreground">{snapshot}</span>
              ) : null}
              {links.length ? (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {links.map((link) => (
                    <span
                      key={`${item.entityId}:${item.recordId}:${link.href}`}
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-xs',
                        link.kind === 'primary'
                          ? 'border-primary text-primary'
                          : 'border-muted-foreground/40 text-muted-foreground',
                      )}
                    >
                      {link.label ?? link.href}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )
    },
    meta: { priority: 1 },
  },
  {
    id: 'score',
    header: 'Score',
    cell: ({ row }) => <span>{row.original.score != null ? row.original.score.toFixed(2) : '—'}</span>,
    meta: { priority: 2 },
  },
  {
    id: 'updated',
    header: 'Updated',
    cell: ({ row }) => {
      const value = row.original.updatedAt
      if (!value) return <span>—</span>
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return <span>—</span>
      return <span>{date.toLocaleString()}</span>
    },
    meta: { priority: 2 },
  },
]

function normalizeLinks(links?: Row['links']): { href: string; label?: string; kind?: string }[] {
  if (!Array.isArray(links)) return []
  return links.filter((link) => typeof link?.href === 'string') as Array<{ href: string; label?: string; kind?: string }>
}

function toPascalCase(input: string): string {
  return input
    .split(/[-_ ]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

type LucideIconComponent = React.ComponentType<{ className?: string }>

function resolveIcon(name?: string): LucideIconComponent | null {
  if (!name) return null
  const key = toPascalCase(name)
  const Icon = (LucideIcons as Record<string, LucideIconComponent | undefined>)[key]
  return typeof Icon === 'function' ? Icon : null
}

function humanizeSegment(segment: string): string {
  return segment
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatEntityId(entityId: string): string {
  if (!entityId.includes(':')) return humanizeSegment(entityId)
  const [module, entity] = entityId.split(':')
  const moduleLabel = humanizeSegment(module)
  const entityLabel = humanizeSegment(entity)
  return `${moduleLabel} · ${entityLabel}`
}

function extractSnapshot(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  const candidateKeys = ['snapshot', 'summary', 'description', 'body', 'content', 'note']
  for (const key of candidateKeys) {
    const value = metadata[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length) return trimmed
    }
  }
  for (const value of Object.values(metadata)) {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length) return trimmed
    }
  }
  return null
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
    const trimmed = searchValue.trim()
    abortRef.current?.abort()
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    if (!apiKeyAvailable) {
      setRows([])
      setError(missingKeyMessage)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    const delay = trimmed.length >= MIN_QUERY_LENGTH ? 250 : 150

    debounceRef.current = window.setTimeout(async () => {
      try {
        if (trimmed.length >= MIN_QUERY_LENGTH) {
          const data = await fetchVectorResults(trimmed, 50, controller.signal)
          const mapped = data.results.map<Row>((item: VectorSearchHit) => ({
            entityId: item.entityId,
            recordId: item.recordId,
            driverId: item.driverId,
            score: typeof item.score === 'number' ? item.score : null,
            url: item.url ?? null,
            presenter: item.presenter ?? null,
            links: item.links ?? null,
            updatedAt: null,
            metadata: (item.metadata as Record<string, unknown> | null) ?? null,
          }))
          setRows(mapped)
          setError(data.error ?? null)
        } else {
          const data = await fetchVectorIndexEntries({ limit: 50, signal: controller.signal })
          const mapped = data.entries.map<Row>((entry: VectorIndexEntry) => ({
            entityId: entry.entityId,
            recordId: entry.recordId,
            driverId: entry.driverId,
            score: entry.score ?? null,
            url: entry.url ?? null,
            presenter: entry.presenter ?? null,
            links: entry.links ?? null,
            updatedAt: entry.updatedAt ?? null,
            metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
          }))
          setRows(mapped)
          setError(data.error ?? null)
        }
        setPage(1)
      } catch (err: any) {
        if (controller.signal.aborted) return
        if (err?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Vector search failed')
        setRows([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, delay)

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
      setError(null)
      const trimmed = searchValue.trim()
      if (trimmed.length >= MIN_QUERY_LENGTH) {
        try {
          const data = await fetchVectorResults(trimmed, 50)
          const mapped = data.results.map<Row>((item: VectorSearchHit) => ({
            entityId: item.entityId,
            recordId: item.recordId,
            driverId: item.driverId,
            score: typeof item.score === 'number' ? item.score : null,
            url: item.url ?? null,
            presenter: item.presenter ?? null,
            links: item.links ?? null,
            updatedAt: null,
            metadata: (item.metadata as Record<string, unknown> | null) ?? null,
          }))
          setRows(mapped)
          setError(data.error ?? null)
        } catch (err: any) {
          setError(err instanceof Error ? err.message : 'Vector search failed')
        }
      } else {
        try {
          const data = await fetchVectorIndexEntries({ limit: 50 })
          const mapped = data.entries.map<Row>((entry: VectorIndexEntry) => ({
            entityId: entry.entityId,
            recordId: entry.recordId,
            driverId: entry.driverId,
            score: entry.score ?? null,
            url: entry.url ?? null,
            presenter: entry.presenter ?? null,
            links: entry.links ?? null,
            updatedAt: entry.updatedAt ?? null,
            metadata: (entry.metadata as Record<string, unknown> | null) ?? null,
          }))
          setRows(mapped)
          setError(data.error ?? null)
        } catch (err: any) {
          setError(err instanceof Error ? err.message : 'Vector index fetch failed')
        }
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
