'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import * as LucideIcons from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { SearchResult, SearchStrategyId } from '@open-mercato/shared/modules/search'
import { cn } from '@open-mercato/shared/lib/utils'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'
import { fetchHybridSearchResults } from '../utils'

type Row = {
  entityId: string
  recordId: string
  source: string
  score: number | null
  url: string | null
  presenter: SearchResult['presenter'] | null
  links: SearchResult['links'] | null
  metadata: Record<string, unknown> | null
}

const MIN_QUERY_LENGTH = 2
const ALL_STRATEGIES: SearchStrategyId[] = ['fulltext', 'vector', 'tokens']

type Translator = (
  key: string,
  fallbackOrParams?: string | Record<string, string | number>,
  params?: Record<string, string | number>
) => string

function createColumns(t: Translator): ColumnDef<Row>[] {
  return [
    {
      id: 'title',
      header: () => t('search.table.columns.result', 'Result'),
      cell: ({ row }) => {
        const item = row.original
        const title = resolveRowTitle(item)
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
                  <span className="font-medium whitespace-normal break-all">{title}</span>
                  <span className="rounded border border-muted-foreground/40 px-2 py-0.5 text-xs text-muted-foreground">
                    {typeLabel}
                  </span>
                </div>
                {snapshot ? (
                  <span className="text-sm text-muted-foreground whitespace-normal break-words">{snapshot}</span>
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
                            : 'border-muted-foreground/40 text-muted-foreground'
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
      id: 'source',
      header: () => t('search.table.columns.source', 'Source'),
      cell: ({ row }) => {
        const source = row.original.source
        const colorClass = getStrategyColorClass(source)
        return (
          <span className={cn('rounded px-2 py-0.5 text-xs font-medium', colorClass)}>
            {source}
          </span>
        )
      },
      meta: { priority: 2 },
    },
    {
      id: 'score',
      header: () => t('search.table.columns.score', 'Score'),
      cell: ({ row }) => <span>{row.original.score != null ? row.original.score.toFixed(2) : '—'}</span>,
      meta: { priority: 2 },
    },
  ]
}

function getStrategyColorClass(strategy: string): string {
  switch (strategy) {
    case 'fulltext':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
    case 'vector':
      return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
    case 'tokens':
      return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
  }
}

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

function resolveIcon(name?: string): LucideIcon | null {
  if (!name) return null
  const key = toPascalCase(name)
  const candidate = (LucideIcons as Record<string, unknown>)[key]
  if (typeof candidate === 'function') {
    return candidate as LucideIcon
  }
  return null
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

function resolveRowTitle(row: Row): string {
  const presenterTitle = row.presenter?.title
  if (typeof presenterTitle === 'string') {
    const trimmed = presenterTitle.trim()
    if (trimmed.length) return trimmed
  }
  return row.recordId
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
  return null
}

function pickPrimaryLink(row: Row): string | null {
  if (row.url) return row.url
  const links = normalizeLinks(row.links)
  if (!links.length) return null
  const primary = links.find((link) => link.kind === 'primary')
  return (primary ?? links[0]).href
}

function normalizeErrorMessage(input: unknown, fallback?: string): string | null {
  const fallbackMessage = typeof fallback === 'string' && fallback.trim().length ? fallback.trim() : null
  let message: string | null = null
  if (typeof input === 'string') {
    message = input
  } else if (input instanceof Error && typeof input.message === 'string') {
    message = input.message
  }
  if (message) {
    const trimmed = message.trim()
    if (trimmed.length) {
      const sanitized = trimmed.replace(/^\[[^\]]+\]\s*/, '').trim()
      if (sanitized.length) return sanitized
    }
  }
  return fallbackMessage
}

export function HybridSearchTable() {
  const router = useRouter()
  const t = useT()
  const [searchValue, setSearchValue] = React.useState('')
  const [rows, setRows] = React.useState<Row[]>([])
  const [page, setPage] = React.useState(1)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [timing, setTiming] = React.useState<number | null>(null)
  const [strategiesUsed, setStrategiesUsed] = React.useState<string[]>([])
  const [enabledStrategies, setEnabledStrategies] = React.useState<Set<SearchStrategyId>>(
    new Set(ALL_STRATEGIES)
  )
  const debounceRef = React.useRef<number | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)
  const columns = React.useMemo(() => createColumns(t), [t])

  const toggleStrategy = React.useCallback((strategy: SearchStrategyId) => {
    setEnabledStrategies((prev) => {
      const next = new Set(prev)
      if (next.has(strategy)) {
        next.delete(strategy)
      } else {
        next.add(strategy)
      }
      return next
    })
  }, [])

  const openRow = React.useCallback(
    (row: Row) => {
      const href = pickPrimaryLink(row)
      if (!href) return
      router.push(href)
    },
    [router]
  )

  React.useEffect(() => {
    const trimmed = searchValue.trim()
    abortRef.current?.abort()
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }

    if (trimmed.length < MIN_QUERY_LENGTH) {
      setRows([])
      setTiming(null)
      setStrategiesUsed([])
      setError(null)
      setLoading(false)
      return
    }

    if (enabledStrategies.size === 0) {
      setRows([])
      setTiming(null)
      setStrategiesUsed([])
      setError(t('search.table.errors.noStrategies', 'Select at least one search strategy'))
      setLoading(false)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    debounceRef.current = window.setTimeout(async () => {
      try {
        const data = await fetchHybridSearchResults(trimmed, {
          limit: 50,
          strategies: Array.from(enabledStrategies),
          signal: controller.signal,
        })
        const mapped = data.results.map<Row>((item) => ({
          entityId: item.entityId,
          recordId: item.recordId,
          source: item.source,
          score: typeof item.score === 'number' ? item.score : null,
          url: item.url ?? null,
          presenter: item.presenter ?? null,
          links: item.links ?? null,
          metadata: (item.metadata as Record<string, unknown> | null) ?? null,
        }))
        setRows(mapped)
        setTiming(data.timing)
        setStrategiesUsed(data.strategiesUsed)
        const message = data.error ? normalizeErrorMessage(data.error, t('search.table.errors.searchFailed', 'Search failed')) : null
        setError(message ?? null)
        setPage(1)
      } catch (err: unknown) {
        if (controller.signal.aborted) return
        if ((err as { name?: string })?.name === 'AbortError') return
        setError(normalizeErrorMessage(err, t('search.table.errors.searchFailed', 'Search failed')))
        setRows([])
        setTiming(null)
        setStrategiesUsed([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 250)

    return () => {
      controller.abort()
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [searchValue, enabledStrategies, t])

  React.useEffect(() => {
    if (!error) return
    flash(error, 'error')
  }, [error])

  return (
    <div className="flex w-full flex-col gap-4">
      {/* Strategy Checkboxes */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/50 p-3">
        <span className="text-sm font-medium text-muted-foreground">
          {t('search.table.strategies', 'Strategies:')}
        </span>
        {ALL_STRATEGIES.map((strategy) => (
          <label key={strategy} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-4 rounded border-gray-300"
              checked={enabledStrategies.has(strategy)}
              onChange={() => toggleStrategy(strategy)}
            />
            <span
              className={cn(
                'rounded px-2 py-0.5 text-xs font-medium',
                getStrategyColorClass(strategy)
              )}
            >
              {strategy}
            </span>
          </label>
        ))}
      </div>

      {/* Stats Bar */}
      {timing !== null && rows.length > 0 && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span>{rows.length} {t('search.table.stats.results', 'results')}</span>
          <span>{timing}ms</span>
          {strategiesUsed.length > 0 && (
            <span>
              {t('search.table.stats.sources', 'Sources:')} {strategiesUsed.join(', ')}
            </span>
          )}
        </div>
      )}

      {/* Error Alert */}
      {error ? (
        <div
          role="alert"
          className="w-full rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      {/* Data Table */}
      <DataTable<Row>
        title={t('search.table.title', 'Search')}
        columns={columns}
        data={rows}
        searchValue={searchValue}
        onSearchChange={(value) => {
          setSearchValue(value)
          setPage(1)
        }}
        searchPlaceholder={t('search.table.searchPlaceholder', 'Search across all strategies...')}
        isLoading={loading}
        pagination={{ page, pageSize: rows.length || 1, total: rows.length, totalPages: 1, onPageChange: setPage }}
        onRowClick={(row) => openRow(row)}
        rowActions={(row) => {
          const primaryHref = pickPrimaryLink(row)
          if (!primaryHref) return null
          return <RowActions items={[{ label: t('search.table.actions.open', 'Open'), href: primaryHref }]} />
        }}
        embedded
      />
    </div>
  )
}

export default HybridSearchTable
