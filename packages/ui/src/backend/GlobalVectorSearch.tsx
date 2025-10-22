"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Search, Loader2 } from 'lucide-react'
import * as LucideIcons from 'lucide-react'
import { Dialog, DialogContent } from '../primitives/dialog'
import { Input } from '../primitives/input'
import { apiFetch } from './utils/api'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type LucideIconComponent = React.ComponentType<{ className?: string; size?: number }>

export type GlobalVectorSearchProps = {
  searchApi?: string
  shortcut?: string
  minQueryLength?: number
}

type SearchResult = {
  id: string
  entityType: string
  recordId: string
  moduleId: string
  title: string
  lead: string | null
  icon: string | null
  url: string
  similarity: number
}

type SearchResponse = {
  items: SearchResult[]
  embeddingReady: boolean
}

function resolveIconComponent(name: string | null | undefined): LucideIconComponent | null {
  if (!name) return null
  const registry = LucideIcons as Record<string, LucideIconComponent | undefined>
  return registry[name] ?? null
}

export function GlobalVectorSearch({ searchApi = '/api/vector-search/search', shortcut = '⌘K', minQueryLength = 2 }: GlobalVectorSearchProps) {
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const router = useRouter()
  const t = useT()

  React.useEffect(() => {
    if (!open) return
    const t = setTimeout(() => inputRef.current?.focus(), 10)
    return () => clearTimeout(t)
  }, [open])

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().includes('MAC')
      const comboPressed = isMac ? event.metaKey && event.key.toLowerCase() === 'k' : event.ctrlKey && event.key.toLowerCase() === 'k'
      if (comboPressed) {
        event.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const trimmed = query.trim()
  const canSearch = trimmed.length >= minQueryLength

  const { data, isFetching } = useQuery<SearchResponse | null>({
    queryKey: ['global-vector-search', trimmed],
    queryFn: async () => {
      if (!canSearch) return null
      const res = await apiFetch(searchApi, {
        method: 'POST',
        body: JSON.stringify({ query: trimmed }),
        headers: { 'content-type': 'application/json' },
      })
      if (!res.ok) throw new Error('Failed to query vector search API')
      return res.json()
    },
    enabled: open,
    staleTime: 5_000,
  })

  const results = data?.items ?? []
  const embeddingReady = data?.embeddingReady ?? true
  const showEmptyState = canSearch && !isFetching && results.length === 0

  const handleSelect = (item: SearchResult) => {
    if (!item?.url) return
    setOpen(false)
    router.push(item.url)
  }

  return (
    <>
      <button
        type="button"
        className="inline-flex items-center gap-2 rounded border px-2 py-1 text-sm font-medium hover:bg-accent"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" />
        <span className="hidden md:inline">{t('vector_search.overlay.trigger', 'Search')}</span>
        <span className="ml-2 text-xs text-muted-foreground hidden sm:inline">{shortcut}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 border rounded px-3 py-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('vector_search.overlay.placeholder', 'Search records across modules')}
                className="border-0 focus-visible:ring-0 focus-visible:outline-none"
              />
              <span className="text-xs text-muted-foreground hidden sm:inline">{shortcut}</span>
            </div>
            {!embeddingReady ? (
              <div className="rounded border border-yellow-300 bg-yellow-50 text-yellow-900 px-3 py-2 text-sm">
                {t('vector_search.empty.configure', 'Set VECTOR_SEARCH_OPENAI_API_KEY to enable embeddings.')}
              </div>
            ) : null}
            <div className="max-h-[320px] overflow-y-auto rounded border divide-y">
              {isFetching && canSearch ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching…
                </div>
              ) : null}
              {!isFetching && !canSearch ? (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  {t('vector_search.table.search_hint', 'Type at least {min} characters to search.').replace('{min}', String(minQueryLength))}
                </div>
              ) : null}
              {showEmptyState ? (
                <div className="p-6 text-sm text-muted-foreground text-center">{t('vector_search.table.no_results', 'No matching records found.')}</div>
              ) : null}
              {results.map((item) => {
                const Icon = resolveIconComponent(item.icon)
                const similarity = Number.isFinite(item.similarity) ? Math.max(0, Math.min(1, item.similarity)) : 0
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-accent flex items-start gap-3"
                    onClick={() => handleSelect(item)}
                  >
                    <div className="mt-1 text-muted-foreground">
                      {Icon ? <Icon className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium text-sm">{item.title}</div>
                      {item.lead ? <div className="text-xs text-muted-foreground line-clamp-2">{item.lead}</div> : null}
                      <div className="text-[11px] text-muted-foreground mt-1 flex gap-2">
                        <span>{item.entityType}</span>
                        <span>•</span>
                        <span>{item.moduleId}</span>
                      </div>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {(similarity * 100).toFixed(0)}%
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
