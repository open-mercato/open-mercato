'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2 } from 'lucide-react'
import { Dialog, DialogContent } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { cn } from '@open-mercato/shared/lib/utils'
import type { VectorSearchHit } from '@open-mercato/vector'
import { fetchVectorResults } from '../utils'

type VectorLink = { href: string; label?: string; kind?: string }
type VectorSearchResult = VectorSearchHit

const MIN_QUERY_LENGTH = 2

function normalizeLinks(links?: VectorLink[] | null): VectorLink[] {
  if (!Array.isArray(links)) return []
  return links.filter((link) => typeof link?.href === 'string')
}

function pickPrimaryLink(result: VectorSearchResult): string | null {
  if (result.url) return result.url
  const links = normalizeLinks(result.links)
  if (!links.length) return null
  const primary = links.find((link) => link.kind === 'primary')
  return (primary ?? links[0]).href
}

export function VectorSearchDialog({ apiKeyAvailable, missingKeyMessage }: { apiKeyAvailable: boolean; missingKeyMessage: string }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<VectorSearchResult[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(apiKeyAvailable ? null : missingKeyMessage)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const abortRef = React.useRef<AbortController | null>(null)

  const resetState = React.useCallback(() => {
    setQuery('')
    setResults([])
    setError(apiKeyAvailable ? null : missingKeyMessage)
    setSelectedIndex(0)
    setLoading(false)
  }, [apiKeyAvailable, missingKeyMessage])

  React.useEffect(() => {
    if (!open) {
      resetState()
      return
    }
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, resetState])

  React.useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])

  React.useEffect(() => {
    if (!open) return
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 50)
    return () => clearTimeout(focusTimer)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    if (!apiKeyAvailable) {
      setError(missingKeyMessage)
      setResults([])
      setLoading(false)
      return
    }

    abortRef.current?.abort()
    if (query.trim().length < MIN_QUERY_LENGTH) {
      setResults([])
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)

    const handle = setTimeout(async () => {
      try {
        const data = await fetchVectorResults(query, 8, controller.signal)
        setResults(data.results)
        setError(data.error ?? null)
        setSelectedIndex(0)
      } catch (err: any) {
        if (controller.signal.aborted) return
        if (err?.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Vector search failed')
        setResults([])
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 220)

    return () => {
      clearTimeout(handle)
      controller.abort()
    }
  }, [open, query, apiKeyAvailable, missingKeyMessage])

  const openResult = React.useCallback((result: VectorSearchResult | undefined) => {
    if (!result) return
    const href = pickPrimaryLink(result)
    if (!href) return
    router.push(href)
    setOpen(false)
  }, [router])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      openResult(results[selectedIndex])
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % Math.max(results.length || 1, 1))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((prev) => {
        if (!results.length) return 0
        return prev <= 0 ? results.length - 1 : prev - 1
      })
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const target = results[selectedIndex]
      openResult(target)
      return
    }
  }, [results, selectedIndex, openResult])

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)} className="hidden sm:inline-flex items-center gap-2">
        <Search className="h-4 w-4" />
        <span>Search</span>
        <span className="ml-2 rounded border px-1 text-xs text-muted-foreground">⌘K</span>
      </Button>
      <Button type="button" variant="ghost" size="icon" className="sm:hidden" onClick={() => setOpen(true)} aria-label="Open global search">
        <Search className="h-4 w-4" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl p-0" aria-describedby="vector-search-description">
          <span id="vector-search-description" className="sr-only">
            Type to search across indexed records. Use arrow keys to navigate results.
          </span>
          <div className="flex flex-col gap-3 border-b px-4 pb-3 pt-4">
            <div className="flex items-center gap-2 rounded border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search customers, notes, deals, todos…"
                className="border-none px-0 shadow-none focus-visible:ring-0"
                autoFocus
                disabled={!apiKeyAvailable}
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            {error ? (
              <p className="rounded bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
            ) : null}
          </div>
          <div className="max-h-96 overflow-y-auto px-2 pb-3">
            {results.length === 0 && !loading && !error ? (
              <div className="px-4 py-6 text-sm text-muted-foreground">
                {query.trim().length < MIN_QUERY_LENGTH
                  ? 'Type at least two characters to search indexed records.'
                  : 'No results found.'}
              </div>
            ) : null}
            <ul className="flex flex-col">
              {results.map((result, index) => {
                const presenter = result.presenter
                const isActive = index === selectedIndex
                return (
                  <li key={`${result.entityId}:${result.recordId}`}>
                    <button
                      type="button"
                      onClick={() => openResult(result)}
                      onMouseEnter={() => setSelectedIndex(index)}
                      className={cn(
                        'w-full rounded px-4 py-3 text-left transition',
                        isActive ? 'bg-primary/10 text-primary-foreground' : 'hover:bg-muted'
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-medium">{presenter?.title ?? result.recordId}</div>
                          {presenter?.subtitle ? (
                            <div className="text-sm text-muted-foreground">{presenter.subtitle}</div>
                          ) : null}
                        </div>
                        <div className="text-xs text-muted-foreground">{result.entityId}</div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {normalizeLinks(result.links).map((link) => (
                          <span key={`${link.href}`} className={cn(
                            'rounded-full border px-2 py-0.5 text-xs',
                            link.kind === 'primary' ? 'border-primary text-primary' : 'border-muted-foreground/40 text-muted-foreground'
                          )}>
                            {link.label ?? link.href}
                          </span>
                        ))}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
          <div className="flex items-center justify-between border-t px-4 py-3">
            <span className="text-xs text-muted-foreground">Press ⌘K to toggle · ⌘⏎ to open</span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel (Esc)
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => openResult(results[selectedIndex])}
                disabled={!results.length}
              >
                Open (⌘⏎)
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
